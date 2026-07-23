import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  ClaudeCliExecutor,
  CodexCliExecutor,
  LocalEchoExecutor,
} from "./executors.js";
import { planGraph } from "./planner.js";
import { runGraph } from "./runtime.js";
import type { GraphSpec, PlanGraphRequest } from "./types.js";
import { validateGraph } from "./validator.js";

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > 2_000_000) throw new Error("request exceeds 2 MB");
    chunks.push(value);
  }
  return chunks.length
    ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
    : {};
}

function respond(
  response: ServerResponse,
  status: number,
  value: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(value));
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function authorized(request: IncomingMessage, apiKey?: string): boolean {
  if (!apiKey) return true;
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(apiKey, "utf8");
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

export function startGraphServer(
  options: { host?: string; port?: number; apiKey?: string } = {},
): ReturnType<typeof createServer> {
  const host =
    options.host ?? process.env.GRAPH_ENGINEER_HOST ?? "127.0.0.1";
  const port =
    options.port ?? Number(process.env.GRAPH_ENGINEER_PORT ?? "4318");
  const apiKey = options.apiKey ?? process.env.GRAPH_ENGINEER_API_KEY;
  if (!isLoopback(host) && !apiKey) {
    throw new Error(
      "GRAPH_ENGINEER_API_KEY is required when binding beyond loopback",
    );
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("graph server port must be an integer from 0 to 65535");
  }
  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/healthz") {
        respond(response, 200, { status: "ok", version: "1.0" });
        return;
      }
      if (
        request.url?.startsWith("/v1/") &&
        !authorized(request, apiKey)
      ) {
        respond(
          response,
          401,
          { error: "unauthorized" },
          { "www-authenticate": "Bearer" },
        );
        return;
      }
      if (request.method !== "POST") {
        respond(response, 404, { error: "not found" });
        return;
      }
      const input = (await body(request)) as Record<string, unknown>;
      if (request.url === "/v1/graphs/plan") {
        respond(response, 200, planGraph(input as unknown as PlanGraphRequest));
        return;
      }
      if (request.url === "/v1/graphs/validate") {
        respond(response, 200, validateGraph(input as unknown as GraphSpec));
        return;
      }
      if (request.url === "/v1/graphs/run") {
        const graph =
          "graph" in input
            ? (input.graph as GraphSpec)
            : planGraph(input as unknown as PlanGraphRequest);
        const approvals =
          Boolean(apiKey) &&
          process.env.GRAPH_ENGINEER_ALLOW_HTTP_APPROVALS === "1" &&
          Array.isArray(input.approvals)
          ? input.approvals.filter(
              (value): value is string => typeof value === "string",
            )
          : [];
        respond(
          response,
          200,
          await runGraph(graph, {
            executors: {
              codex: new CodexCliExecutor(),
              claude: new ClaudeCliExecutor(),
              local: new LocalEchoExecutor(),
            },
            approvals,
          }),
        );
        return;
      }
      respond(response, 404, { error: "not found" });
    } catch (error) {
      respond(response, 400, { error: (error as Error).message });
    }
  });
  server.listen(port, host);
  return server;
}
