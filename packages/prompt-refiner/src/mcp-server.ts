#!/usr/bin/env node
import { createInterface } from "node:readline";
import { collectContext } from "./context.js";
import { refinePrompt } from "./provider.js";
import { runEvaluation } from "./evaluation.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id: JsonRpcRequest["id"], value: unknown): void {
  send({ jsonrpc: "2.0", id: id ?? null, result: value });
}

function error(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
): void {
  send({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

const TOOLS = [
  {
    name: "refine_prompt",
    description:
      "Convert a user request into an intent-preserving, permission-safe execution brief.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", minLength: 1 },
        mode: {
          type: "string",
          enum: ["auto", "silent", "visible", "strict"],
        },
        semantic: { type: "boolean" },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
  {
    name: "evaluate_prompt_refiner",
    description:
      "Run the built-in deterministic safety and intent-preservation evaluation suite.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

async function handle(request: JsonRpcRequest): Promise<void> {
  if (request.method === "initialize") {
    result(request.id, {
      protocolVersion:
        (request.params?.protocolVersion as string | undefined) ??
        "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "prompt-refiner", version: "0.3.1" },
      instructions:
        "Use refine_prompt before substantive work. Preserve the original request and never expand permissions.",
    });
    return;
  }
  if (request.method === "notifications/initialized") return;
  if (request.method === "ping") {
    result(request.id, {});
    return;
  }
  if (request.method === "tools/list") {
    result(request.id, { tools: TOOLS });
    return;
  }
  if (request.method === "tools/call") {
    const name = request.params?.name;
    const args = (request.params?.arguments ?? {}) as Record<string, unknown>;
    if (name === "refine_prompt") {
      if (typeof args.prompt !== "string") {
        error(request.id, -32602, "prompt must be a string");
        return;
      }
      const refined = await refinePrompt({
        prompt: args.prompt,
        ...(typeof args.mode === "string"
          ? { mode: args.mode as "auto" | "silent" | "visible" | "strict" }
          : {}),
        ...(typeof args.semantic === "boolean"
          ? { semantic: args.semantic }
          : {}),
        context: await collectContext(),
      });
      result(request.id, {
        content: [
          {
            type: "text",
            text: JSON.stringify(refined, null, 2),
          },
        ],
        structuredContent: refined,
      });
      return;
    }
    if (name === "evaluate_prompt_refiner") {
      const report = runEvaluation();
      result(request.id, {
        content: [
          { type: "text", text: JSON.stringify(report, null, 2) },
        ],
        structuredContent: report,
        isError: report.failed > 0,
      });
      return;
    }
    error(request.id, -32601, `unknown tool: ${String(name)}`);
    return;
  }
  error(request.id, -32601, `unknown method: ${request.method}`);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  if (!line.trim()) return;
  void (async () => {
    try {
      await handle(JSON.parse(line) as JsonRpcRequest);
    } catch (caught) {
      error(null, -32700, (caught as Error).message);
    }
  })();
});
