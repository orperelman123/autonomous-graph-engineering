import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { validateGraph } from "../packages/graph-orchestrator/dist/validator.js";

const supportedHosts = new Set([
  "codex",
  "claude",
  "cursor",
  "copilot",
  "hermes",
]);

const safetyCeilings = {
  maxNodes: 16,
  maxParallel: 4,
  maxFanout: 8,
  maxDepth: 9,
  maxRepairRounds: 2,
  timeoutMs: 900_000,
  maxEstimatedTokens: 200_000,
  maxActualTokens: 500_000,
};

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function canonicalSha256(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function assertSafeRepositoryPath(path, label = "path") {
  const segments = String(path).split("/");
  if (
    !path ||
    isAbsolute(path) ||
    /^[A-Za-z]:/.test(path) ||
    path.includes("\\") ||
    segments.includes("..") ||
    segments.includes(".") ||
    segments.includes("") ||
    path.startsWith("/")
  ) {
    throw new Error(`${label} must be a normalized repository-relative path`);
  }
}

function assertNoPrivateData(value, location = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoPrivateData(item, `${location}[${index}]`),
    );
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      assertNoPrivateData(child, `${location}.${key}`);
    }
    return;
  }
  if (typeof value !== "string") return;
  const prohibited = [
    ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ["GitHub token", /\bgh[opsu]_[A-Za-z0-9]{20,}\b/],
    ["provider key", /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/],
    ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
    ["user-specific Windows path", /\b[A-Za-z]:[\\/]Users[\\/][^\\/\s]+/i],
    ["user-specific POSIX path", /\/(?:home|Users)\/[^/\s]+|\/root(?:\/|\b)/],
  ];
  for (const [label, pattern] of prohibited) {
    if (pattern.test(value)) {
      throw new Error(`${location} contains a prohibited ${label}`);
    }
  }
}

export function assertUniqueTemplateIds(templates) {
  const ids = templates.map((template) => template?.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("community template ids must be unique");
  }
}

export async function loadTemplateSchemaValidator(root) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const graphSchema = JSON.parse(
    await readFile(join(root, "schemas", "autonomous-graph.schema.json"), "utf8"),
  );
  const templateSchema = JSON.parse(
    await readFile(
      join(root, "schemas", "community-graph-template.schema.json"),
      "utf8",
    ),
  );
  ajv.addSchema(graphSchema);
  return ajv.compile(templateSchema);
}

export async function assertCommunityTemplate(template, root) {
  assertSafeRepositoryPath(template.provenance.origin.path, "origin path");
  assertNoPrivateData(template);

  const maintainerIds = template.provenance.maintainers.map(
    (maintainer) => maintainer.id,
  );
  if (new Set(maintainerIds).size !== maintainerIds.length) {
    throw new Error("maintainer ids must be unique");
  }

  const hostIds = template.compatibility.hosts.map((host) => host.id);
  if (
    new Set(hostIds).size !== hostIds.length ||
    hostIds.some((host) => !supportedHosts.has(host))
  ) {
    throw new Error("compatibility hosts must be unique supported host ids");
  }
  if (
    template.compatibility.hosts.some(
      (host) => host.status !== "contract-only",
    )
  ) {
    throw new Error("community templates may claim contract-only hosts only");
  }

  const digest = canonicalSha256(template.graph);
  if (digest !== template.provenance.graphSha256) {
    throw new Error("embedded graph does not match provenance.graphSha256");
  }

  const validation = validateGraph(template.graph);
  if (!validation.valid) {
    throw new Error(
      `embedded graph failed runtime validation: ${validation.errors
        .map((issue) => issue.code)
        .join(", ")}`,
    );
  }
  if (!["plan_only", "read_only"].includes(template.graph.autonomy)) {
    throw new Error("community templates must use plan_only or read_only autonomy");
  }
  if (
    template.graph.nodes.some(
      (node) =>
        !["none", "read"].includes(node.permission) ||
        node.kind === "human_gate",
    )
  ) {
    throw new Error(
      "community templates must contain only none/read nodes and no human gates",
    );
  }
  for (const [budget, ceiling] of Object.entries(safetyCeilings)) {
    const value = template.graph.budgets[budget];
    if (value !== undefined && value > ceiling) {
      throw new Error(`${budget} exceeds the community template ceiling`);
    }
  }

  const rootPrefix = `${resolve(root)}${sep}`;
  const sourcePath = resolve(
    root,
    ...template.provenance.origin.path.split("/"),
  );
  if (!sourcePath.startsWith(rootPrefix)) {
    throw new Error("origin path resolved outside the repository");
  }
  const sourceGraph = JSON.parse(await readFile(sourcePath, "utf8"));
  if (canonicalJson(sourceGraph) !== canonicalJson(template.graph)) {
    throw new Error("embedded graph does not match its repository origin");
  }
}

export async function verifyCommunityTemplates({ directory, root }) {
  const validateSchema = await loadTemplateSchemaValidator(root);
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".template.json"))
    .sort();
  if (names.length === 0) {
    throw new Error("no community template files found");
  }

  const loaded = [];
  for (const name of names) {
    const path = join(directory, name);
    const text = await readFile(path, "utf8");
    loaded.push({ name, path, text, template: JSON.parse(text) });
  }
  assertUniqueTemplateIds(loaded.map((entry) => entry.template));

  const templates = [];
  const errors = [];
  for (const entry of loaded) {
    const template = entry.template;
    let passed = true;
    if (!validateSchema(template)) {
      passed = false;
      errors.push(
        `${entry.name}: schema: ${JSON.stringify(validateSchema.errors)}`,
      );
    } else {
      try {
        await assertCommunityTemplate(template, root);
      } catch (error) {
        passed = false;
        errors.push(
          `${entry.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    templates.push({
      id: String(template.id ?? "invalid"),
      path: relative(root, entry.path).replaceAll("\\", "/"),
      sha256: createHash("sha256").update(entry.text).digest("hex"),
      graphSha256: String(template.provenance?.graphSha256 ?? "0".repeat(64)),
      hosts: Array.isArray(template.compatibility?.hosts)
        ? template.compatibility.hosts.map((host) => host.id)
        : [],
      passed,
    });
  }
  return {
    version: "1.0",
    verifier: "graphvigil-community-template",
    passed: errors.length === 0,
    templates,
    errors,
  };
}
