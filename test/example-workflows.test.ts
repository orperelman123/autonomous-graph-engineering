import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { GraphSpec } from "../packages/graph-orchestrator/src/types.js";

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
