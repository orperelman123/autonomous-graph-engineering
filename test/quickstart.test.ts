import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";
import {
  assembleQuickstartReport,
} from "../scripts/quickstart-lib.mjs";

const execute = promisify(execFile);

test("quickstart produces a measurable offline first-workflow report", async () => {
  const { stdout } = await execute(
    process.execPath,
    ["scripts/quickstart.mjs", "--json"],
    { cwd: process.cwd() },
  );
  const report = JSON.parse(stdout) as {
    status: string;
    offline: boolean;
    providerCredentialsRequired: boolean;
    steps: Array<{ id: string; passed: boolean; evidence: unknown }>;
    summary: { total: number; passed: number; failed: number };
  };

  assert.equal(report.status, "ready");
  assert.equal(report.offline, true);
  assert.equal(report.providerCredentialsRequired, false);
  assert.deepEqual(
    report.steps.map((step) => step.id),
    [
      "environment",
      "prompt-refinement",
      "generated-workflow",
      "committed-workflows",
    ],
  );
  assert.equal(report.summary.total, 4);
  assert.equal(report.summary.passed, 4);
  assert.equal(report.summary.failed, 0);
  const committedWorkflows = (await readdir("examples"))
    .filter((file) => file.endsWith(".graph.json"))
    .sort()
    .map((file) => file.replace(".graph.json", ""));
  assert.deepEqual(
    (report.steps[3]?.evidence as { workflows: string[] }).workflows,
    committedWorkflows,
  );
  assert.doesNotMatch(stdout, /[A-Z]:\\|\/Users\/|\/home\//);
});

test("quickstart fails closed when any workflow contract is invalid", () => {
  const report = assembleQuickstartReport({
    doctor: {
      status: "ready",
      summary: { passed: 7, warnings: 2, failures: 0 },
    },
    refinement: {
      status: "ready",
      classification: "investigation",
      brief: { permissionsRequired: [] },
    },
    promptPreserved: true,
    graph: {
      autonomy: "read_only",
      budgets: { maxParallel: 2, maxRepairRounds: 1 },
      nodes: [
        {
          id: "inspect",
          kind: "agent",
          permission: "read",
        },
      ],
    },
    validation: { valid: true, errors: [] },
    examples: [
      {
        workflow: "repository-audit",
        schemaValid: true,
        runtimeValid: false,
      },
    ],
  });

  assert.equal(report.status, "blocked");
  assert.equal(report.summary.failed, 1);
  assert.equal(report.steps[3]?.passed, false);
});
