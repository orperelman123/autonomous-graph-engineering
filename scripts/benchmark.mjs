import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  planGraph,
  runGraph,
  validateGraph,
} from "../packages/graph-orchestrator/dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(
  await readFile(
    join(root, "benchmark", "fixtures", "control-plane.v1.json"),
    "utf8",
  ),
);
const fixtureSha256 = createHash("sha256")
  .update(JSON.stringify(fixture))
  .digest("hex");
const promptHash = createHash("sha256").update(fixture.task).digest("hex");
const pinnedBudgets = {
  maxNodes: 8,
  maxParallel: 4,
  maxFanout: 4,
  maxDepth: 6,
  maxRepairRounds: 1,
  timeoutMs: 60_000,
  maxEstimatedTokens: 200_000,
  maxActualTokens: 200_000,
};

class DeterministicExecutor {
  name = "deterministic-benchmark";
  calls = 0;
  verifierCalls = 0;

  async execute(request) {
    this.calls += 1;
    if (request.nodeId === "scope") {
      return {
        output: {
          items: fixture.items,
        },
      };
    }
    if (
      request.nodeId === "verify" ||
      request.nodeId === "acceptance" ||
      request.nodeId.startsWith("reverify:")
    ) {
      this.verifierCalls += 1;
      return {
        output: {
          accepted: this.verifierCalls > 1,
          reasons:
            this.verifierCalls > 1
              ? []
              : [fixture.verifier.rejectionReason],
        },
      };
    }
    return {
      output: {
        nodeId: request.nodeId,
        evidence: ["deterministic fixture"],
      },
    };
  }
}

function directGraph(repairEnabled) {
  const graph = planGraph({
    prompt: "Inspect package metadata.",
    autonomy: "read_only",
    primaryExecutor: "local",
    verifierExecutor: "local",
  });
  graph.repairPolicy = {
    ...graph.repairPolicy,
    enabled: repairEnabled,
  };
  graph.goal = fixture.task;
  graph.originalPromptHash = promptHash;
  graph.budgets = { ...pinnedBudgets };
  const execute = graph.nodes.find((node) => node.id === "execute");
  if (execute) execute.prompt = fixture.task;
  return graph;
}

function fullGraph() {
  const graph = planGraph({
    prompt: fixture.task,
    autonomy: "read_only",
    primaryExecutor: "local",
    verifierExecutor: "local",
    forceGraph: true,
  });
  graph.budgets = { ...pinnedBudgets };
  return graph;
}

async function runScenario(name, graph) {
  const validation = validateGraph(graph);
  if (!validation.valid) {
    throw new Error(
      `${name} graph invalid: ${validation.errors
        .map((error) => error.message)
        .join("; ")}`,
    );
  }
  const executor = new DeterministicExecutor();
  const directory = await mkdtemp(join(tmpdir(), `graph-benchmark-${name}-`));
  try {
    const result = await runGraph(graph, {
      executors: { local: executor },
      auditDirectory: directory,
    });
    const verifierNodeId =
      graph.repairPolicy?.verifierNodeId ??
      graph.nodes.find((node) => node.kind === "verifier")?.id;
    const verifierOutput = verifierNodeId
      ? result.outputs[verifierNodeId]
      : undefined;
    const expected = fixture.expected[name];
    const accepted =
      verifierOutput &&
      typeof verifierOutput === "object" &&
      "accepted" in verifierOutput
        ? verifierOutput.accepted
        : false;
    return {
      name,
      status: result.status,
      nodeCount: graph.nodes.length,
      executorCalls: executor.calls,
      verifierCalls: executor.verifierCalls,
      repairRounds: result.repairRounds,
      budgets: graph.budgets,
      parallelMapNodes: graph.nodes.filter(
        (node) => node.kind === "parallel_map",
      ).length,
      humanGates: graph.nodes.filter((node) => node.kind === "human_gate")
        .length,
      checkpointed: Boolean(result.checkpointPath),
      audited: Boolean(result.auditPath),
      verifier: verifierOutput ?? null,
      usage: result.usage ?? {},
      passed:
        result.status === expected.status &&
        result.repairRounds === expected.repairRounds &&
        accepted === expected.accepted,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const scenarios = [
  await runScenario("direct-no-repair", directGraph(false)),
  await runScenario("bounded-loop", directGraph(true)),
  await runScenario("validated-graph", fullGraph()),
];
const passed = scenarios.every((scenario) => scenario.passed);
const report = {
  version: "1.0",
  benchmark: "deterministic-control-plane",
  fixture: {
    id: fixture.id,
    version: fixture.version,
    seed: fixture.seed,
    sha256: fixtureSha256,
    task: fixture.task,
  },
  behavior:
    "Every verifier rejects its first candidate and accepts the next candidate.",
  scope: [
    "Measures orchestration behavior, repair bounds, checkpointing, and audit production.",
    "Does not measure model intelligence, answer quality, token cost, or wall-clock performance.",
    "Uses no provider credentials and makes no network requests.",
  ],
  passed,
  scenarios,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = passed ? 0 : 1;
