import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

async function stopChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolveExit) =>
    child.once("exit", () => resolveExit()),
  );
  child.stdin.end();
  child.kill();
  await Promise.race([
    exited,
    new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 2_000)),
  ]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
}

test("MCP server initializes and exposes refinement tools", async () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const serverPath = resolve(testDir, "..", "src", "mcp-server.ts");
  const child = spawn(
    process.execPath,
    ["--import", "tsx", serverPath],
    {
      cwd: resolve(testDir, ".."),
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  const lines: string[] = [];
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    lines.push(...chunk.split(/\r?\n/).filter(Boolean));
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
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    })}\n`,
  );

  await new Promise<void>((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("MCP server response timed out"));
    }, 5000);
    const poll = setInterval(() => {
      if (lines.length >= 2) {
        clearInterval(poll);
        clearTimeout(timeout);
        resolvePromise();
      }
    }, 10);
  });

  await stopChild(child);
  const responses = lines.map((line) => JSON.parse(line)) as Array<{
    id: number;
    result?: { tools?: Array<{ name: string }> };
  }>;
  assert.equal(responses[0]?.id, 1);
  assert.equal(responses[1]?.id, 2);
  assert.deepEqual(
    responses[1]?.result?.tools?.map((tool) => tool.name),
    [
      "refine_prompt",
      "get_runtime_info",
      "evaluate_prompt_refiner",
    ],
  );
});
