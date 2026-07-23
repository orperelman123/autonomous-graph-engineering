import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { LocalEchoExecutor } from "./executors.js";
import { planGraph } from "./planner.js";
import { runGraph } from "./runtime.js";
import type {
  GraphEvaluationReport,
  GraphSpec,
} from "./types.js";
import { validateGraph } from "./validator.js";

type EvaluationCase = {
  id: string;
  run: () => Promise<string[]>;
};

function mutatedGraph(
  mutate: (graph: GraphSpec) => void,
  prompt = "Research all services and compare their behavior.",
): GraphSpec {
  const graph = planGraph({
    prompt,
    autonomy: "read_only",
    primaryExecutor: "local",
    verifierExecutor: "local",
    forceGraph: true,
  });
  mutate(graph);
  return graph;
}

const cases: EvaluationCase[] = [
  {
    id: "simple-routes-direct",
    run: async () => {
      const graph = planGraph({ prompt: "Explain this function." });
      return graph.metadata.routing === "direct"
        ? []
        : ["simple prompt did not route direct"];
    },
  },
  {
    id: "complex-routes-graph",
    run: async () => {
      const graph = planGraph({
        prompt:
          "Audit every route across all services in parallel and verify each finding.",
      });
      return graph.metadata.routing === "graph"
        ? []
        : ["complex prompt did not route to graph"];
    },
  },
  {
    id: "consequential-adds-gate",
    run: async () => {
      const graph = planGraph({
        prompt: "Deploy the approved site to production.",
        autonomy: "consequential",
      });
      const validation = validateGraph(graph);
      return graph.nodes.some((node) => node.kind === "human_gate") &&
        validation.valid
        ? []
        : ["consequential graph lacks a valid gate"];
    },
  },
  {
    id: "cycle-rejected",
    run: async () => {
      const graph = mutatedGraph((value) => {
        value.nodes[0]?.dependsOn.push("acceptance");
      });
      return validateGraph(graph).errors.some(
        (issue) => issue.code === "CYCLE_DETECTED",
      )
        ? []
        : ["cycle was accepted"];
    },
  },
  {
    id: "missing-dependency-rejected",
    run: async () => {
      const graph = mutatedGraph((value) => {
        value.nodes[0]?.dependsOn.push("missing");
      });
      return validateGraph(graph).errors.some(
        (issue) => issue.code === "MISSING_DEPENDENCY",
      )
        ? []
        : ["missing dependency was accepted"];
    },
  },
  {
    id: "node-budget-enforced",
    run: async () => {
      const graph = mutatedGraph((value) => {
        value.budgets.maxNodes = 1;
      });
      return validateGraph(graph).errors.some(
        (issue) => issue.code === "NODE_BUDGET_EXCEEDED",
      )
        ? []
        : ["node budget was not enforced"];
    },
  },
  {
    id: "parallel-budget-enforced",
    run: async () => {
      const graph = mutatedGraph((value) => {
        const node = value.nodes.find(
          (candidate) => candidate.kind === "parallel_map",
        );
        if (node) node.maxConcurrency = 100;
      });
      return validateGraph(graph).errors.some(
        (issue) => issue.code === "PARALLEL_BUDGET_EXCEEDED",
      )
        ? []
        : ["parallel budget was not enforced"];
    },
  },
  {
    id: "depth-budget-enforced",
    run: async () => {
      const graph = mutatedGraph((value) => {
        value.budgets.maxDepth = 1;
      });
      return validateGraph(graph).errors.some(
        (issue) => issue.code === "DEPTH_BUDGET_EXCEEDED",
      )
        ? []
        : ["depth budget was not enforced"];
    },
  },
  {
    id: "permission-escalation-rejected",
    run: async () => {
      const graph = mutatedGraph((value) => {
        const node = value.nodes.find((candidate) => candidate.kind === "agent");
        if (node) node.permission = "write";
      });
      return validateGraph(graph).errors.some(
        (issue) => issue.code === "PERMISSION_EXCEEDS_AUTONOMY",
      )
        ? []
        : ["permission escalation was accepted"];
    },
  },
  {
    id: "ungated-external-rejected",
    run: async () => {
      const graph = mutatedGraph((value) => {
        value.autonomy = "consequential";
        const node = value.nodes.find((candidate) => candidate.kind === "agent");
        if (node) node.permission = "external";
      });
      return validateGraph(graph).errors.some(
        (issue) => issue.code === "MISSING_HUMAN_GATE",
      )
        ? []
        : ["ungated external action was accepted"];
    },
  },
  {
    id: "parallel-write-isolation-enforced",
    run: async () => {
      const graph = mutatedGraph((value) => {
        value.autonomy = "workspace";
        const node = value.nodes.find(
          (candidate) => candidate.kind === "parallel_map",
        );
        if (node) {
          node.permission = "write";
          node.isolation = "shared";
          node.maxConcurrency = 2;
        }
      });
      return validateGraph(graph).errors.some(
        (issue) => issue.code === "UNISOLATED_PARALLEL_WRITE",
      )
        ? []
        : ["unisolated parallel writes were accepted"];
    },
  },
  {
    id: "repair-budget-enforced",
    run: async () => {
      const graph = mutatedGraph((value) => {
        value.budgets.maxRepairRounds = 100;
      });
      return validateGraph(graph).errors.some(
        (issue) => issue.code === "INVALID_REPAIR_BUDGET",
      )
        ? []
        : ["unbounded repair budget was accepted"];
    },
  },
  {
    id: "token-budget-enforced",
    run: async () => {
      const graph = mutatedGraph((value) => {
        value.budgets.maxEstimatedTokens = 1;
      });
      return validateGraph(graph).errors.some(
        (issue) => issue.code === "TOKEN_BUDGET_EXCEEDED",
      )
        ? []
        : ["token budget was not enforced"];
    },
  },
  {
    id: "human-gate-blocks-runtime",
    run: async () => {
      const graph = planGraph({
        prompt: "Delete the temporary file.",
        autonomy: "consequential",
        primaryExecutor: "local",
      });
      const directory = resolve(tmpdir(), `graph-eval-${randomUUID()}`);
      const result = await runGraph(graph, {
        executors: { local: new LocalEchoExecutor() },
        auditDirectory: directory,
      });
      await rm(directory, { recursive: true, force: true });
      return result.status === "needs_confirmation"
        ? []
        : ["runtime bypassed human gate"];
    },
  },
  {
    id: "read-only-graph-completes",
    run: async () => {
      const graph = planGraph({
        prompt:
          "Research every service in parallel, compare results, and verify findings.",
        autonomy: "read_only",
        primaryExecutor: "local",
        verifierExecutor: "local",
        forceGraph: true,
      });
      const directory = resolve(tmpdir(), `graph-eval-${randomUUID()}`);
      const result = await runGraph(graph, {
        executors: { local: new LocalEchoExecutor() },
        auditDirectory: directory,
      });
      await rm(directory, { recursive: true, force: true });
      return result.status === "completed"
        ? []
        : [`read-only graph ended as ${result.status}: ${result.error ?? ""}`];
    },
  },
  {
    id: "duplicate-node-rejected",
    run: async () => {
      const graph = mutatedGraph((value) => {
        const node = value.nodes[0];
        if (node) value.nodes.push({ ...node });
      });
      return validateGraph(graph).errors.some(
        (issue) => issue.code === "DUPLICATE_NODE",
      )
        ? []
        : ["duplicate node was accepted"];
    },
  },
  {
    id: "invalid-node-id-rejected",
    run: async () => {
      const graph = mutatedGraph((value) => {
        if (value.nodes[0]) value.nodes[0].id = "../escape";
      });
      return validateGraph(graph).errors.some(
        (issue) => issue.code === "INVALID_NODE_ID",
      )
        ? []
        : ["unsafe node id was accepted"];
    },
  },
  {
    id: "missing-executor-rejected",
    run: async () => {
      const graph = mutatedGraph((value) => {
        const node = value.nodes.find((candidate) => candidate.kind === "agent");
        if (node) delete node.executor;
      });
      return validateGraph(graph).errors.some(
        (issue) => issue.code === "MISSING_EXECUTOR",
      )
        ? []
        : ["agent without executor was accepted"];
    },
  },
  {
    id: "plan-only-does-not-execute",
    run: async () => {
      const graph = planGraph({
        prompt: "Audit all routes.",
        autonomy: "plan_only",
        primaryExecutor: "local",
        forceGraph: true,
      });
      const result = await runGraph(graph, {
        executors: { local: new LocalEchoExecutor() },
      });
      return result.status === "plan_only" &&
        Object.keys(result.outputs).length === 0
        ? []
        : ["plan-only graph executed nodes"];
    },
  },
  {
    id: "self-dependency-rejected",
    run: async () => {
      const graph = mutatedGraph((value) => {
        const node = value.nodes[0];
        if (node) node.dependsOn.push(node.id);
      });
      return validateGraph(graph).errors.some(
        (issue) => issue.code === "SELF_DEPENDENCY",
      )
        ? []
        : ["self dependency was accepted"];
    },
  },
];

export async function runGraphEvaluation(): Promise<GraphEvaluationReport> {
  const started = performance.now();
  const results = [];
  for (const testCase of cases) {
    try {
      const failures = await testCase.run();
      results.push({
        id: testCase.id,
        passed: failures.length === 0,
        failures,
      });
    } catch (error) {
      results.push({
        id: testCase.id,
        passed: false,
        failures: [(error as Error).message],
      });
    }
  }
  const passed = results.filter((result) => result.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length === 0 ? 1 : passed / results.length,
    durationMs: Math.round((performance.now() - started) * 100) / 100,
    results,
  };
}
