import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";
import {
  assertCompatibilityMatrix,
  expectedHosts,
} from "../scripts/compatibility-matrix-lib.mjs";

const execute = promisify(execFile);

async function fixture() {
  return JSON.parse(
    await readFile(
      new URL("../compatibility/host-matrix.v1.json", import.meta.url),
      "utf8",
    ),
  );
}

test("offline host compatibility matrix passes deterministically for all hosts", async () => {
  const first = await execute(process.execPath, [
    "scripts/compatibility-matrix.mjs",
  ]);
  const second = await execute(process.execPath, [
    "scripts/compatibility-matrix.mjs",
  ]);
  assert.equal(first.stdout, second.stdout);
  const report = JSON.parse(first.stdout);
  assert.equal(report.passed, true);
  assert.deepEqual(
    report.cases.map((item: { host: string }) => item.host),
    expectedHosts,
  );
  assert.ok(
    report.cases.every(
      (item: { passed: boolean; evidence: Array<{ exists: boolean }> }) =>
        item.passed && item.evidence.every((evidence) => evidence.exists),
    ),
  );
});

test("matrix rejects missing or duplicate host coverage", async () => {
  const missing = await fixture();
  missing.hosts.pop();
  assert.throws(
    () => assertCompatibilityMatrix(missing),
    /each supported host exactly once/,
  );

  const duplicate = await fixture();
  duplicate.hosts[4] = structuredClone(duplicate.hosts[0]);
  assert.throws(
    () => assertCompatibilityMatrix(duplicate),
    /each supported host exactly once/,
  );
});

test("matrix rejects private, absolute, and traversal evidence paths", async () => {
  for (const hostilePath of [
    "../private.txt",
    "/etc/passwd",
    "C:\\Users\\private.txt",
    "docs\\installation.md",
  ]) {
    const matrix = await fixture();
    matrix.hosts[0].evidence[0] = hostilePath;
    assert.throws(
      () => assertCompatibilityMatrix(matrix),
      /repository-relative/,
      hostilePath,
    );
  }
});

test("matrix prevents unsupported live-version claims", async () => {
  const noEvidence = await fixture();
  noEvidence.hosts[0].versionCoverage.status = "live-tested";
  noEvidence.hosts[0].versionCoverage.testedVersions = ["unverified-version"];
  assert.throws(
    () => assertCompatibilityMatrix(noEvidence),
    /requires versions and live evidence/,
  );

  const falseContractClaim = await fixture();
  falseContractClaim.hosts[0].versionCoverage.testedVersions = [
    "unverified-version",
  ];
  assert.throws(
    () => assertCompatibilityMatrix(falseContractClaim),
    /cannot claim tested versions/,
  );
});
