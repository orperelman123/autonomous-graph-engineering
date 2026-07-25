import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tag = process.argv[2] ?? "";

function fail(message) {
  throw new Error(`release verification failed: ${message}`);
}

if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
  fail("tag must be an exact stable semver prefixed with v");
}

const paths = [
  "package.json",
  "packages/prompt-refiner/package.json",
  "packages/graph-orchestrator/package.json",
  "plugins/prompt-refiner/package.json",
  "plugins/prompt-refiner/plugin.json",
  "plugins/prompt-refiner/.codex-plugin/plugin.json",
  "plugins/prompt-refiner/.cursor-plugin/plugin.json",
];
const manifests = await Promise.all(
  paths.map(async (path) =>
    JSON.parse(await readFile(resolve(root, path), "utf8")),
  ),
);
const version = tag.slice(1);
for (const [index, manifest] of manifests.entries()) {
  if (manifest.version !== version) {
    fail(`${paths[index]} has ${manifest.version}, expected ${version}`);
  }
}

const promptName = "@autonomous-graph-engineering/prompt-refiner";
const graph = manifests[2];
if (graph.dependencies?.[promptName] !== version) {
  fail(`graph-engineer must depend on ${promptName}@${version}`);
}

const expectedRepository =
  "git+https://github.com/orperelman123/autonomous-graph-engineering.git";
for (const [index, manifest] of manifests.slice(1, 3).entries()) {
  if (manifest.repository?.url !== expectedRepository) {
    fail(`${paths[index + 1]} repository must exactly match GitHub`);
  }
  if (manifest.publishConfig?.access !== "public") {
    fail(`${paths[index + 1]} must publish with public access`);
  }
}

const marketplacePath = ".github/plugin/marketplace.json";
const marketplace = JSON.parse(
  await readFile(resolve(root, marketplacePath), "utf8"),
);
if (marketplace.metadata?.version !== version) {
  fail(
    `${marketplacePath} metadata has ${marketplace.metadata?.version}, expected ${version}`,
  );
}
if (marketplace.plugins?.[0]?.version !== version) {
  fail(
    `${marketplacePath} plugin has ${marketplace.plugins?.[0]?.version}, expected ${version}`,
  );
}

for (const path of [
  "packages/prompt-refiner/src/version.ts",
  "packages/graph-orchestrator/src/version.ts",
]) {
  const source = await readFile(resolve(root, path), "utf8");
  if (!source.includes(`= "${version}";`)) {
    fail(`${path} does not export version ${version}`);
  }
}

const lockPath = "package-lock.json";
const lock = JSON.parse(await readFile(resolve(root, lockPath), "utf8"));
for (const [path, actual] of [
  ["version", lock.version],
  ['packages[""].version', lock.packages?.[""]?.version],
  [
    'packages["packages/prompt-refiner"].version',
    lock.packages?.["packages/prompt-refiner"]?.version,
  ],
  [
    'packages["packages/graph-orchestrator"].version',
    lock.packages?.["packages/graph-orchestrator"]?.version,
  ],
  [
    'packages["packages/graph-orchestrator"].dependencies',
    lock.packages?.["packages/graph-orchestrator"]?.dependencies?.[promptName],
  ],
]) {
  if (actual !== version) {
    fail(`${lockPath} ${path} has ${actual}, expected ${version}`);
  }
}

const templatePath = "templates/repository-audit.template.json";
const template = JSON.parse(
  await readFile(resolve(root, templatePath), "utf8"),
);
if (template.compatibility?.graphvigilVersion !== version) {
  fail(
    `${templatePath} has ${template.compatibility?.graphvigilVersion}, expected ${version}`,
  );
}

const templateSchemaPath = "schemas/community-graph-template.schema.json";
const templateSchema = JSON.parse(
  await readFile(resolve(root, templateSchemaPath), "utf8"),
);
const expectedVersionPattern = `^${version.replaceAll(".", "\\.")}$`;
const actualVersionPattern =
  templateSchema.properties?.compatibility?.properties?.graphvigilVersion
    ?.pattern;
if (actualVersionPattern !== expectedVersionPattern) {
  fail(
    `${templateSchemaPath} has ${actualVersionPattern}, expected ${expectedVersionPattern}`,
  );
}

process.stdout.write(
  `${JSON.stringify({
    tag,
    version,
    packages: manifests.slice(1, 3).map(({ name }) => name),
    pluginManifests: paths.length - 3,
    marketplace: marketplacePath,
    communityTemplate: templatePath,
    repository: expectedRepository,
  })}\n`,
);
