import { createServer } from "node:http";
import { collectContext } from "./context.js";
import { buildHookResponse } from "./hook.js";
import { refinePrompt } from "./provider.js";
async function readBody(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > 1_000_000)
            throw new Error("request body exceeds 1 MB");
        chunks.push(buffer);
    }
    if (chunks.length === 0)
        return {};
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function json(response, status, body) {
    response.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
    });
    response.end(JSON.stringify(body));
}
export function startServer(options = {}) {
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
            const body = (await readBody(request));
            if (request.url === "/v1/refine") {
                const refineRequest = body;
                json(response, 200, await refinePrompt(refineRequest));
                return;
            }
            if (request.url === "/hooks/claude" ||
                request.url === "/hooks/codex") {
                const prompt = body.prompt;
                if (typeof prompt !== "string") {
                    json(response, 400, { error: "hook payload must contain prompt" });
                    return;
                }
                if (prompt.trimStart().startsWith("!raw")) {
                    json(response, 200, { continue: true });
                    return;
                }
                const result = await refinePrompt({
                    prompt,
                    mode: "auto",
                    ...(typeof body.cwd === "string"
                        ? { context: await collectContext(body.cwd) }
                        : {}),
                    semantic: process.env.PROMPT_REFINER_SEMANTIC === "true",
                });
                json(response, 200, buildHookResponse(typeof body.hook_event_name === "string"
                    ? body.hook_event_name
                    : "UserPromptSubmit", result));
                return;
            }
            json(response, 404, { error: "not found" });
        }
        catch (error) {
            json(response, 400, { error: error.message });
        }
    });
    server.listen(port, host);
    return server;
}
//# sourceMappingURL=server.js.map