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
  assert.equal(listed?.result?.tools?.length, 6);
});

test("MCP starts and polls a graph without holding the request open", async () => {
  const serverPath = fileURLToPath(
    new URL("../src/mcp-server.ts", import.meta.url),
  );
  const child = spawn(process.execPath, ["--import", "tsx", serverPath], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  type RpcResponse = {
    id?: number;
    result?: {
      structuredContent?: {
        jobId?: string;
        status?: string;
        result?: { status?: string };
      };
    };
    error?: { message?: string };
  };
  const responses: RpcResponse[] = [];
  let buffered = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffered += chunk;
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) responses.push(JSON.parse(line) as RpcResponse);
    }
  });
  const send = (id: number, method: string, params?: unknown): void => {
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
  };
  const waitFor = async (id: number): Promise<RpcResponse> => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const response = responses.find((candidate) => candidate.id === id);
      if (response) return response;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`MCP response ${id} timed out`);
  };
  const graph = {
    version: "1.0",
    id: "mcp-async-local",
    goal: "Exercise asynchronous MCP graph execution.",
    originalPromptHash: "test-hash",
    autonomy: "read_only",
    createdAt: new Date().toISOString(),
    budgets: {
      maxNodes: 1,
      maxParallel: 1,
      maxFanout: 1,
      maxDepth: 1,
      maxRepairRounds: 0,
      timeoutMs: 5_000,
      maxEstimatedTokens: 10_000,
      maxActualTokens: 10_000,
    },
    nodes: [
      {
        id: "echo",
        label: "Echo locally",
        kind: "agent",
        dependsOn: [],
        permission: "read",
        executor: "local",
        prompt: "Return the input.",
      },
    ],
    metadata: { routing: "direct", planner: "test" },
  };

  try {
    send(1, "initialize", { protocolVersion: "2025-03-26" });
    await waitFor(1);
    send(2, "tools/call", {
      name: "start_graph",
      arguments: { graph },
    });
    const started = await waitFor(2);
    assert.equal(started.error, undefined);
    const jobId = started.result?.structuredContent?.jobId;
    assert.ok(jobId);
    assert.equal(started.result?.structuredContent?.status, "running");

    let completed: RpcResponse | undefined;
    for (let id = 3; id < 20; id += 1) {
      send(id, "tools/call", {
        name: "get_graph_run",
        arguments: { jobId },
      });
      const polled = await waitFor(id);
      if (polled.result?.structuredContent?.status !== "running") {
        completed = polled;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(completed?.result?.structuredContent?.status, "completed");
    assert.equal(
      completed?.result?.structuredContent?.result?.status,
      "completed",
    );
  } finally {
    child.kill();
  }
});

test("MCP tool errors preserve the originating request ID", async () => {
  const serverPath = fileURLToPath(
    new URL("../src/mcp-server.ts", import.meta.url),
  );
  const child = spawn(process.execPath, ["--import", "tsx", serverPath], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const response = await new Promise<{
    id?: number;
    error?: { code?: number; message?: string };
  }>((resolve, reject) => {
    let buffered = "";
    const deadline = setTimeout(
      () => reject(new Error("MCP error response timed out")),
      5_000,
    );
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffered += chunk;
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line) as {
          id?: number;
          error?: { code?: number; message?: string };
        };
        if (parsed.id === 41) {
          clearTimeout(deadline);
          resolve(parsed);
        }
      }
    });
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 41,
        method: "tools/call",
        params: {
          name: "get_graph_run",
          arguments: { jobId: "missing-job" },
        },
      })}\n`,
    );
  });
  child.kill();
  assert.equal(response.id, 41);
  assert.equal(response.error?.code, -32603);
  assert.match(response.error?.message ?? "", /unknown graph job/);
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
