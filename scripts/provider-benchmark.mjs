import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseClaudeEnvelope,
  parseCodexJsonl,
} from "../packages/graph-orchestrator/dist/executors.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(
  await readFile(
    join(root, "benchmark", "fixtures", "provider-envelopes.v1.json"),
    "utf8",
  ),
);
const sha256 = createHash("sha256")
  .update(JSON.stringify(fixture))
  .digest("hex");

const cases = fixture.cases.map((testCase) => {
  const actual =
    testCase.provider === "codex"
      ? parseCodexJsonl(testCase.stdout)
      : parseClaudeEnvelope(testCase.stdout);
  return {
    provider: testCase.provider,
    passed: JSON.stringify(actual) === JSON.stringify(testCase.expected),
    actual,
    expected: testCase.expected,
  };
});
const report = {
  version: "1.0",
  benchmark: "offline-provider-envelope-compatibility",
  fixture: {
    id: fixture.id,
    version: fixture.version,
    sha256,
  },
  scope: [
    "Validates deterministic parsing of pinned Codex JSONL and Claude JSON envelopes.",
    "Uses synthetic fixtures, no credentials, and no network requests.",
    "Does not measure live provider availability, model quality, latency, or cost.",
  ],
  passed: cases.every((testCase) => testCase.passed),
  cases,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.passed ? 0 : 1;
