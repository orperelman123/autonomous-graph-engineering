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

process.stdout.write(
  `${JSON.stringify({
    tag,
    version,
    packages: manifests.slice(1, 3).map(({ name }) => name),
    repository: expectedRepository,
  })}\n`,
);
