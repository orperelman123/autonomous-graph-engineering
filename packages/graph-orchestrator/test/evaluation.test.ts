import assert from "node:assert/strict";
import test from "node:test";
import { runGraphEvaluation } from "../src/evaluation.js";

test("passes the complete adversarial graph evaluation suite", async () => {
  const report = await runGraphEvaluation();

  assert.equal(report.total, 21);
  assert.equal(report.failed, 0, JSON.stringify(report.results, null, 2));
  assert.equal(report.passRate, 1);
});
