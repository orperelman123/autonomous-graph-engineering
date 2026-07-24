#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { getRuntimeInfo } from "@autonomous-graph-engineering/prompt-refiner";
import { runGraphEvaluation } from "./evaluation.js";
import { planGraph } from "./planner.js";
import { runGraph } from "./runtime.js";
import { defaultExecutors } from "./security.js";
import type {
  GraphRunResult,
  GraphSpec,
  PlanGraphRequest,
} from "./types.js";
import { validateGraph } from "./validator.js";
import { GRAPH_ENGINEER_VERSION } from "./version.js";

type Request = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

type GraphJob = {
  jobId: string;
  graphId: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  result?: GraphRunResult;
  error?: string;
};

const jobs = new Map<string, GraphJob>();

function jobLimit(): number {
  const configured = Number(process.env.GRAPH_ENGINEER_MCP_MAX_JOBS ?? 16);
  return Number.isInteger(configured) && configured >= 1 && configured <= 128
    ? configured
    : 16;
}

function makeExecutors() {
  return defaultExecutors();
}

function pruneCompletedJobs(): void {
  const completed = [...jobs.values()]
    .filter((job) => job.status !== "running")
    .sort((left, right) =>
      (left.completedAt ?? left.startedAt).localeCompare(
        right.completedAt ?? right.startedAt,
      ),
    );
  while (jobs.size >= jobLimit() && completed.length > 0) {
    const oldest = completed.shift();
    if (oldest) jobs.delete(oldest.jobId);
  }
  if (jobs.size >= jobLimit()) {
    throw new Error(
      `MCP graph job limit reached (${jobLimit()} running jobs)`,
    );
  }
}

function startGraphJob(graph: GraphSpec): GraphJob {
  const validation = validateGraph(graph);
  if (!validation.valid) {
    throw new Error(
      `graph validation failed: ${validation.errors
        .map((error) => `${error.code}: ${error.message}`)
        .join("; ")}`,
    );
  }
  pruneCompletedJobs();
  const job: GraphJob = {
    jobId: randomUUID(),
    graphId: graph.id,
    status: "running",
    startedAt: new Date().toISOString(),
  };
  jobs.set(job.jobId, job);
  void runGraph(graph, {
    executors: makeExecutors(),
    approvals: [],
  }).then(
    (result) => {
      job.status = "completed";
      job.result = result;
      job.completedAt = new Date().toISOString();
    },
    (error) => {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : String(error);
      job.completedAt = new Date().toISOString();
    },
  );
  return job;
}

function publicJob(job: GraphJob): GraphJob {
  return { ...job };
}

function send(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function ok(id: Request["id"], value: unknown): void {
  send({ jsonrpc: "2.0", id: id ?? null, result: value });
}

function fail(id: Request["id"], code: number, message: string): void {
  send({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

const tools = [
  {
    name: "get_runtime_info",
    description:
      "Report the active GraphVigil installation identity and whether this host must reload after an upgrade.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "plan_graph",
    description:
      "Compile a request into a bounded autonomous graph without executing it.",
    inputSchema: {
      type: "object",
      required: ["prompt"],
      properties: {
        prompt: { type: "string", minLength: 1 },
        autonomy: {
          enum: ["plan_only", "read_only", "workspace", "consequential"],
        },
        primaryExecutor: { enum: ["codex", "claude", "local"] },
        verifierExecutor: { enum: ["codex", "claude", "local"] },
        forceGraph: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "validate_graph",
    description:
      "Validate graph topology, budgets, permissions, isolation, and convergence.",
    inputSchema: {
      type: "object",
      required: ["graph"],
      properties: { graph: { type: "object" } },
      additionalProperties: false,
    },
  },
  {
    name: "run_graph",
    description:
      "Execute a validated short graph synchronously. Prefer start_graph and get_graph_run when execution may approach the MCP client timeout. This MCP surface never approves human gates.",
    inputSchema: {
      type: "object",
      required: ["graph"],
      properties: {
        graph: { type: "object" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "start_graph",
    description:
      "Start a validated graph in the background and immediately return a job ID for polling. Use this for multi-agent or potentially long-running graphs.",
    inputSchema: {
      type: "object",
      required: ["graph"],
      properties: {
        graph: { type: "object" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_graph_run",
    description:
      "Read the status and eventual result of a graph job created by start_graph.",
    inputSchema: {
      type: "object",
      required: ["jobId"],
      properties: {
        jobId: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "evaluate_graph_runtime",
    description:
      "Run the built-in adversarial graph planner, validator, scheduler, gate, and budget evaluation suite.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

async function handle(request: Request): Promise<void> {
  if (request.method === "initialize") {
    ok(request.id, {
      protocolVersion:
        (request.params?.protocolVersion as string | undefined) ??
        "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: {
        name: "graph-engineer",
        version: GRAPH_ENGINEER_VERSION,
      },
      instructions:
        "Plan first. Validate every graph. Never expand permissions. Require human gates for consequential actions.",
    });
    return;
  }
  if (request.method === "notifications/initialized") return;
  if (request.method === "ping") {
    ok(request.id, {});
    return;
  }
  if (request.method === "tools/list") {
    ok(request.id, { tools });
    return;
  }
  if (request.method !== "tools/call") {
    fail(request.id, -32601, `unknown method: ${request.method}`);
    return;
  }
  const name = request.params?.name;
  const args = (request.params?.arguments ?? {}) as Record<string, unknown>;
  let output: unknown;
  if (name === "get_runtime_info") {
    output = await getRuntimeInfo("graph-engineer", GRAPH_ENGINEER_VERSION);
  } else if (name === "plan_graph") {
    output = planGraph(args as unknown as PlanGraphRequest);
  } else if (name === "validate_graph") {
    output = validateGraph(args.graph as GraphSpec);
  } else if (name === "run_graph") {
    output = await runGraph(args.graph as GraphSpec, {
      executors: makeExecutors(),
      approvals: [],
    });
  } else if (name === "start_graph") {
    output = publicJob(startGraphJob(args.graph as GraphSpec));
  } else if (name === "get_graph_run") {
    const jobId = args.jobId as string;
    const job = jobs.get(jobId);
    if (!job) throw new Error(`unknown graph job: ${jobId}`);
    output = publicJob(job);
  } else if (name === "evaluate_graph_runtime") {
    output = await runGraphEvaluation();
  } else {
    fail(request.id, -32601, `unknown tool: ${String(name)}`);
    return;
  }
  ok(request.id, {
    content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
    structuredContent: output,
  });
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  if (!line.trim()) return;
  void (async () => {
    let request: Request;
    try {
      request = JSON.parse(line) as Request;
    } catch (error) {
      fail(null, -32700, (error as Error).message);
      return;
    }
    try {
      await handle(request);
    } catch (error) {
      fail(request.id, -32603, (error as Error).message);
    }
  })();
});
