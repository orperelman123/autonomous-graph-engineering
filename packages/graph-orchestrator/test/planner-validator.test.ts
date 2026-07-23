import assert from "node:assert/strict";
import test from "node:test";
import { planGraph } from "../src/planner.js";
import { validateGraph } from "../src/validator.js";

test("routes a small request directly and a broad request through a graph", () => {
  const direct = planGraph({ prompt: "Explain this function." });
  const graph = planGraph({
    prompt: "Audit every service in parallel, compare the results, and verify every finding.",
  });

  assert.equal(direct.metadata.routing, "direct");
  assert.equal(graph.metadata.routing, "graph");
  assert.equal(validateGraph(graph).valid, true);
});

test("requires a gate before consequential operations", () => {
  const graph = planGraph({
    prompt:
      "Audit every deployment dependency, verify the rollout plan, and deploy the approved application to production.",
    autonomy: "consequential",
    forceGraph: true,
  });
  const gate = graph.nodes.find((node) => node.kind === "human_gate");
  const action = graph.nodes.find(
    (node) =>
      node.id === "act" &&
      (node.permission === "external" ||
        node.permission === "destructive"),
  );
  const acceptance = graph.nodes.find((node) => node.id === "acceptance");

  assert.ok(gate);
  assert.ok(action);
  assert.ok(gate.dependsOn.includes("synthesize"));
  assert.ok(action.dependsOn.includes(gate.id));
  assert.deepEqual(acceptance?.dependsOn, ["act"]);
  assert.equal(validateGraph(graph).valid, true);
});

test("rejects arbitrary cycles", () => {
  const graph = planGraph({
    prompt: "Audit every service and verify the findings.",
    forceGraph: true,
  });
  graph.nodes[0]?.dependsOn.push(graph.nodes.at(-1)?.id ?? "missing");

  const result = validateGraph(graph);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((issue) => issue.code === "CYCLE_DETECTED"));
});

test("rejects parallel writes when isolation is not enforced", () => {
  const graph = planGraph({
    prompt: "Audit every service and verify the findings.",
    autonomy: "workspace",
    forceGraph: true,
  });
  const parallel = graph.nodes.find((node) => node.kind === "parallel_map");
  assert.ok(parallel);
  parallel.permission = "write";
  delete parallel.maxConcurrency;
  parallel.isolation = "shared";
  assert.ok(
    validateGraph(graph).errors.some(
      (issue) => issue.code === "UNISOLATED_PARALLEL_WRITE",
    ),
  );

  parallel.maxConcurrency = 2;
  parallel.isolation = "worktree";
  assert.ok(
    validateGraph(graph).errors.some(
      (issue) => issue.code === "UNENFORCED_WORKTREE_ISOLATION",
    ),
  );
});

test("uses the requested independent verifier for direct plans", () => {
  const graph = planGraph({
    prompt: "Explain this function.",
    primaryExecutor: "codex",
    verifierExecutor: "claude",
  });

  assert.equal(graph.nodes.find((node) => node.id === "execute")?.executor, "codex");
  assert.equal(graph.nodes.find((node) => node.id === "verify")?.executor, "claude");
});

test("rejects malformed budgets and unknown graph enums", () => {
  const malformed = planGraph({ prompt: "Explain this function." }) as unknown as {
    budgets: Record<string, unknown>;
    autonomy: string;
  };
  malformed.budgets.maxNodes = "unbounded";
  malformed.autonomy = "unlimited";

  const result = validateGraph(malformed as never);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((issue) => issue.code === "INVALID_BUDGET_VALUE"));
  assert.ok(result.errors.some((issue) => issue.code === "INVALID_AUTONOMY"));
});

test("rejects unsupported node fields and malformed repair policies", () => {
  const graph = planGraph({ prompt: "Explain this function." }) as unknown as {
    nodes: Array<Record<string, unknown>>;
    repairPolicy: Record<string, unknown>;
  };
  graph.nodes[0]!.routes = { accepted: ["verify"] };
  graph.repairPolicy.repairExecutor = "unbounded-shell";

  const result = validateGraph(graph as never);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((issue) => issue.code === "UNKNOWN_NODE_FIELD"));
  assert.ok(result.errors.some((issue) => issue.code === "INVALID_REPAIR_POLICY"));
});

test("a human gate cannot elevate a read-only graph", () => {
  const graph = planGraph({
    prompt:
      "Audit every deployment dependency and deploy the approved application to production.",
    autonomy: "consequential",
    forceGraph: true,
  });
  graph.autonomy = "read_only";

  const result = validateGraph(graph);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(
      (issue) => issue.code === "PERMISSION_EXCEEDS_AUTONOMY",
    ),
  );
});

test("rejects side effects that would be replayed before a consequential gate", () => {
  const graph = planGraph({
    prompt: "Deploy the approved application to production.",
    autonomy: "consequential",
  });
  const gate = graph.nodes.find((node) => node.kind === "human_gate");
  assert.ok(gate);
  graph.nodes.unshift({
    id: "prewrite",
    label: "Unsafe preflight write",
    kind: "agent",
    dependsOn: [],
    permission: "write",
    executor: "local",
  });
  gate.dependsOn = ["prewrite"];

  const result = validateGraph(graph);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(
      (issue) => issue.code === "CONSEQUENTIAL_PREFLIGHT_SIDE_EFFECT",
    ),
  );
});
