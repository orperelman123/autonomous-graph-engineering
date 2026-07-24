import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { planGraph } from "../src/planner.js";
import { createPortableRunReport } from "../src/report.js";
import { graphFingerprint } from "../src/runtime.js";
import type { GraphRunCheckpoint, GraphRunEvent } from "../src/types.js";

const execute = promisify(execFile);

test("portable run report preserves structural evidence without free text", async () => {
  const directory = await mkdtemp(join(tmpdir(), "graph-report-"));
  const graph = planGraph({
    prompt: "Sensitive repository objective",
    primaryExecutor: "local",
    verifierExecutor: "local",
  });
  const runId = "portable-report";
  const startedAt = new Date(0).toISOString();
  const verifierNodeId = graph.repairPolicy?.verifierNodeId ?? "verify";
  const checkpoint: GraphRunCheckpoint = {
    version: "1.0",
    graph,
    graphHash: graphFingerprint(graph),
    runId,
    status: "completed",
    outputs: {
      [verifierNodeId]: {
        accepted: true,
        reasons: ["Sensitive verifier evidence"],
      },
    },
    nodes: Object.fromEntries(
      graph.nodes.map((node) => [
        node.id,
        {
          nodeId: node.id,
          state: "completed",
          output: { secret: "Sensitive node output" },
          startedAt,
          completedAt: startedAt,
        },
      ]),
    ),
    repairRounds: 0,
    usage: { inputTokens: 10, outputTokens: 5 },
    startedAt,
    updatedAt: startedAt,
    eventSequence: 2,
  };
  const events: GraphRunEvent[] = [
    {
      sequence: 1,
      runId,
      timestamp: startedAt,
      type: "run_started",
      data: { secret: "Sensitive audit evidence" },
    },
    {
      sequence: 2,
      runId,
      timestamp: startedAt,
      type: "run_completed",
      data: { output: "Sensitive terminal output" },
    },
  ];

  try {
    await writeFile(
      join(directory, `${runId}.checkpoint.json`),
      JSON.stringify(checkpoint),
      "utf8",
    );
    await writeFile(
      join(directory, `${runId}.jsonl`),
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8",
    );
    const report = await createPortableRunReport(directory, runId);
    const serialized = JSON.stringify(report);

    assert.equal(report.graph.integrityVerified, true);
    assert.equal(report.evidence.auditSequenceVerified, true);
    assert.equal(report.verifier.accepted, true);
    assert.equal(report.verifier.reasonCount, 1);
    assert.deepEqual(report.execution.usage, {
      inputTokens: 10,
      outputTokens: 5,
    });
    assert.equal(report.evidence.events.length, 2);
    assert.doesNotMatch(serialized, /Sensitive/);
    assert.doesNotMatch(serialized, /graph-report-/);

    const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
    const tsxLoader = pathToFileURL(
      createRequire(import.meta.url).resolve("tsx"),
    ).href;
    const { stdout } = await execute(
      process.execPath,
      ["--import", tsxLoader, cliPath, "report", runId],
      {
        env: {
          ...process.env,
          GRAPH_ENGINEER_AUDIT_DIRECTORY: directory,
        },
      },
    );
    assert.deepEqual(JSON.parse(stdout), report);

    await writeFile(join(directory, `${runId}.jsonl`), "", "utf8");
    assert.equal(
      (await createPortableRunReport(directory, runId)).evidence
        .auditSequenceVerified,
      false,
    );

    await writeFile(
      join(directory, `${runId}.checkpoint.json`),
      JSON.stringify({ ...checkpoint, runId: "different-run" }),
      "utf8",
    );
    await assert.rejects(
      createPortableRunReport(directory, runId),
      /checkpoint run ID mismatch/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
