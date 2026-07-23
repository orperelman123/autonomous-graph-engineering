import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { collectContext } from "./context.js";
import { refinePrompt } from "./provider.js";
import type { RefineRequest } from "./types.js";

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error("request body exceeds 1 MB");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function hookResponse(eventName: string, effectivePrompt: string): unknown {
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: effectivePrompt,
    },
  };
}

export function startServer(options: {
  host?: string;
  port?: number;
} = {}): ReturnType<typeof createServer> {
  const host = options.host ?? process.env.PROMPT_REFINER_HOST ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.PROMPT_REFINER_PORT ?? "4317");
  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/healthz") {
        json(response, 200, { status: "ok", version: "1.0" });
        return;
      }
      if (request.method !== "POST") {
        json(response, 404, { error: "not found" });
        return;
      }
      const body = (await readBody(request)) as Record<string, unknown>;
      if (request.url === "/v1/refine") {
        const refineRequest = body as unknown as RefineRequest;
        const context = refineRequest.context ?? (await collectContext());
        json(
          response,
          200,
          await refinePrompt({ ...refineRequest, context }),
        );
        return;
      }
      if (
        request.url === "/hooks/claude" ||
        request.url === "/hooks/codex"
      ) {
        const prompt = body.prompt;
        if (typeof prompt !== "string") {
          json(response, 400, { error: "hook payload must contain prompt" });
          return;
        }
        const result = await refinePrompt({
          prompt,
          mode: "auto",
          context: await collectContext(
            typeof body.cwd === "string" ? body.cwd : process.cwd(),
          ),
          semantic: process.env.PROMPT_REFINER_SEMANTIC === "true",
        });
        json(
          response,
          200,
          hookResponse(
            typeof body.hook_event_name === "string"
              ? body.hook_event_name
              : "UserPromptSubmit",
            result.effectivePrompt,
          ),
        );
        return;
      }
      json(response, 404, { error: "not found" });
    } catch (error) {
      json(response, 400, { error: (error as Error).message });
    }
  });
  server.listen(port, host);
  return server;
}
