#!/usr/bin/env node
import { createInterface } from "node:readline";
import {
  ClaudeCliExecutor,
  CodexCliExecutor,
  LocalEchoExecutor,
} from "./executors.js";
import { runGraphEvaluation } from "./evaluation.js";
import { planGraph } from "./planner.js";
import { runGraph } from "./runtime.js";
import type { GraphSpec, PlanGraphRequest } from "./types.js";
import { validateGraph } from "./validator.js";

type Request = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

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
      "Execute a validated graph. This MCP surface never approves human gates; consequential runs return needs_confirmation for a human to continue through the CLI.",
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
      serverInfo: { name: "graph-engineer", version: "0.1.0" },
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
  if (name === "plan_graph") {
    output = planGraph(args as unknown as PlanGraphRequest);
  } else if (name === "validate_graph") {
    output = validateGraph(args.graph as GraphSpec);
  } else if (name === "run_graph") {
    output = await runGraph(args.graph as GraphSpec, {
      executors: {
        codex: new CodexCliExecutor(),
        claude: new ClaudeCliExecutor(),
        local: new LocalEchoExecutor(),
      },
      approvals: [],
    });
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
    try {
      await handle(JSON.parse(line) as Request);
    } catch (error) {
      fail(null, -32700, (error as Error).message);
    }
  })();
});
