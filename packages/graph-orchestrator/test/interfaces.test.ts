import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startGraphServer } from "../src/server.js";

test("MCP server initializes and lists all graph tools", async () => {
  const serverPath = fileURLToPath(
    new URL("../src/mcp-server.ts", import.meta.url),
  );
  const child = spawn(
    process.execPath,
    ["--import", "tsx", serverPath],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const responses: Array<{ id?: number; result?: { tools?: unknown[] } }> = [];
  let buffered = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffered += chunk;
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) responses.push(JSON.parse(line));
    }
  });
  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26" },
    })}\n`,
  );
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`,
  );

  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(
      () => reject(new Error("MCP response timed out")),
      5_000,
    );
    const poll = setInterval(() => {
      if (responses.length >= 2) {
        clearInterval(poll);
        clearTimeout(deadline);
        resolve();
      }
    }, 10);
  });
  child.kill();

  assert.ok(responses.some((response) => response.id === 1));
  const listed = responses.find((response) => response.id === 2);
  assert.equal(listed?.result?.tools?.length, 4);
});

test("HTTP server plans and validates graphs on loopback", async () => {
  const server = startGraphServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const health = await fetch(`${base}/healthz`);
    assert.deepEqual(await health.json(), { status: "ok", version: "1.0" });

    const planned = await fetch(`${base}/v1/graphs/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Audit every service and verify findings.",
        autonomy: "plan_only",
        forceGraph: true,
      }),
    });
    const graph = (await planned.json()) as { nodes: unknown[] };
    assert.ok(graph.nodes.length > 1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("HTTP server requires authentication beyond loopback", () => {
  assert.throws(
    () =>
      startGraphServer({
        host: "0.0.0.0",
        port: 0,
        apiKey: "",
      }),
    /GRAPH_ENGINEER_API_KEY is required/,
  );
});

test("HTTP API enforces a configured bearer token", async () => {
  const server = startGraphServer({
    host: "127.0.0.1",
    port: 0,
    apiKey: "test-secret",
  });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);

    const unauthorized = await fetch(`${base}/v1/graphs/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Explain this function." }),
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get("www-authenticate"), "Bearer");

    const authorized = await fetch(`${base}/v1/graphs/plan`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ prompt: "Explain this function." }),
    });
    assert.equal(authorized.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
