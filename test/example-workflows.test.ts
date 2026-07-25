import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { GraphSpec } from "../packages/graph-orchestrator/src/types.js";
import {
  assertCommunityTemplate,
  assertUniqueTemplateIds,
  canonicalSha256,
  loadTemplateSchemaValidator,
  verifyCommunityTemplates,
} from "../scripts/community-template-lib.mjs";

type ExampleGraph = Omit<GraphSpec, "metadata"> & {
  metadata: Record<string, unknown>;
};

const workflowFiles = {
  "repository-audit": "repository-audit.graph.json",
  implementation: "implementation.graph.json",
  migration: "migration.graph.json",
  "release-preparation": "release-preparation.graph.json",
} as const;

async function loadWorkflow(
  workflow: keyof typeof workflowFiles,
): Promise<ExampleGraph> {
  return JSON.parse(
    await readFile(
      new URL(`../examples/${workflowFiles[workflow]}`, import.meta.url),
      "utf8",
    ),
  ) as ExampleGraph;
}

test("example workflow pack preserves bounded permissions and independent verification", async () => {
  for (const workflow of Object.keys(workflowFiles) as Array<
    keyof typeof workflowFiles
  >) {
    const graph = await loadWorkflow(workflow);
    const writeNodes = graph.nodes.filter((node) => node.permission === "write");
    const verifiers = graph.nodes.filter((node) => node.kind === "verifier");

    assert.equal(graph.metadata.example, true, workflow);
    assert.equal(graph.metadata.workflow, workflow, workflow);
    assert.equal(
      graph.metadata.provenance,
      "repository-maintained",
      workflow,
    );
    assert.equal(graph.budgets.maxRepairRounds, 0, workflow);
    assert.equal(
      graph.originalPromptHash,
      createHash("sha256").update(graph.goal).digest("hex"),
      workflow,
    );
    assert.equal(graph.repairPolicy, undefined, workflow);
    assert.ok(graph.budgets.maxActualTokens, workflow);
    assert.ok(
      graph.nodes.every(
        (node) =>
          node.permission !== "external" &&
          node.permission !== "destructive" &&
          node.kind !== "human_gate",
      ),
      workflow,
    );
    assert.equal(verifiers.length, 1, workflow);
    assert.equal(verifiers[0]?.permission, "read", workflow);

    if (workflow === "implementation" || workflow === "migration") {
      assert.equal(graph.autonomy, "workspace", workflow);
      assert.equal(graph.budgets.maxParallel, 1, workflow);
      assert.equal(writeNodes.length, 1, workflow);
      assert.equal(writeNodes[0]?.kind, "agent", workflow);
      assert.notEqual(writeNodes[0]?.executor, verifiers[0]?.executor, workflow);
    } else {
      assert.equal(graph.autonomy, "read_only", workflow);
      assert.equal(writeNodes.length, 0, workflow);
    }
  }
});

async function loadCommunityTemplate() {
  return JSON.parse(
    await readFile(
      new URL("../templates/repository-audit.template.json", import.meta.url),
      "utf8",
    ),
  );
}

test("community template satisfies schema, provenance, runtime, and Hermes contracts", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const template = await loadCommunityTemplate();
  const validateSchema = await loadTemplateSchemaValidator(root);

  assert.equal(
    validateSchema(template),
    true,
    JSON.stringify(validateSchema.errors, null, 2),
  );
  await assertCommunityTemplate(template, root);
  assert.ok(
    template.compatibility.hosts.some(
      (host: { id: string; status: string }) =>
        host.id === "hermes" && host.status === "contract-only",
    ),
  );
  const report = await verifyCommunityTemplates({
    directory: fileURLToPath(new URL("../templates/", import.meta.url)),
    root,
  });
  assert.equal(report.passed, true, JSON.stringify(report.errors, null, 2));
  assert.equal(report.templates.length, 1);
});

test("community template rejects tampering, traversal, private paths, duplicates, and unsupported claims", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const template = await loadCommunityTemplate();
  const validateSchema = await loadTemplateSchemaValidator(root);

  const tampered = structuredClone(template);
  tampered.graph.goal = "Tampered after provenance was recorded.";
  await assert.rejects(
    assertCommunityTemplate(tampered, root),
    /graphSha256/,
  );

  const traversal = structuredClone(template);
  traversal.provenance.origin.path = "../private/graph.json";
  await assert.rejects(
    assertCommunityTemplate(traversal, root),
    /repository-relative/,
  );

  const nonNormalized = structuredClone(template);
  nonNormalized.provenance.origin.path =
    "examples//repository-audit.graph.json";
  await assert.rejects(
    assertCommunityTemplate(nonNormalized, root),
    /repository-relative/,
  );

  const privatePath = structuredClone(template);
  privatePath.summary = `Read ${["C:", "Users", "Example", "private-repository"].join("\\")} locally.`;
  await assert.rejects(
    assertCommunityTemplate(privatePath, root),
    /user-specific Windows path/,
  );

  const privatePosixPath = structuredClone(template);
  privatePosixPath.summary = "Read /root/private-repository locally.";
  await assert.rejects(
    assertCommunityTemplate(privatePosixPath, root),
    /user-specific POSIX path/,
  );

  const excessiveBudget = structuredClone(template);
  excessiveBudget.graph.budgets.maxParallel = 5;
  excessiveBudget.provenance.graphSha256 = canonicalSha256(
    excessiveBudget.graph,
  );
  await assert.rejects(
    assertCommunityTemplate(excessiveBudget, root),
    /maxParallel exceeds/,
  );

  const invalidRuntime = structuredClone(template);
  invalidRuntime.graph.budgets.maxParallel = 0;
  invalidRuntime.provenance.graphSha256 = canonicalSha256(
    invalidRuntime.graph,
  );
  await assert.rejects(
    assertCommunityTemplate(invalidRuntime, root),
    /runtime validation/,
  );

  assert.throws(
    () => assertUniqueTemplateIds([template, structuredClone(template)]),
    /must be unique/,
  );

  const unsupportedClaim = structuredClone(template);
  unsupportedClaim.compatibility.hosts[4].status = "live-tested";
  assert.equal(validateSchema(unsupportedClaim), false);
});
