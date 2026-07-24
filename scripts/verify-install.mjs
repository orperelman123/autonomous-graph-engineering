import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createRequire } from "node:module";

const requestedIndex = process.argv.indexOf("--plugin-dir");
const requested =
  requestedIndex >= 0 ? process.argv[requestedIndex + 1] : undefined;
const pluginTarget = resolve(
  requested ?? join(homedir(), "plugins", "prompt-refiner"),
);
if (basename(pluginTarget) !== "prompt-refiner") {
  throw new Error("plugin target must end in prompt-refiner");
}
const expectAtbash = process.argv.includes("--expect-atbash");

const configuration = JSON.parse(
  await readFile(join(pluginTarget, ".mcp.json"), "utf8"),
);
const expected = new Map([
  ["prompt-refiner", ["refine_prompt", "evaluate_prompt_refiner"]],
  [
    "graph-engineer",
    [
      "plan_graph",
      "validate_graph",
      "run_graph",
      "start_graph",
      "get_graph_run",
      "evaluate_graph_runtime",
    ],
  ],
]);

async function listTools(name, server) {
  if (
    !server ||
    typeof server.command !== "string" ||
    !Array.isArray(server.args) ||
    typeof server.args[0] !== "string"
  ) {
    throw new Error(`invalid MCP configuration for ${name}`);
  }
  await access(server.args[0]);
  const child = spawn(server.command, server.args, {
    cwd: pluginTarget,
    env: { ...process.env, ...(server.env ?? {}) },
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  });
  const responses = [];
  let buffered = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/);
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
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    })}\n`,
  );
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const listed = responses.find((response) => response.id === 2);
    if (listed) {
      child.kill();
      return listed.result?.tools?.map((tool) => tool.name) ?? [];
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  child.kill();
  throw new Error(`${name} MCP server did not respond within 5 seconds`);
}

for (const [name, expectedTools] of expected) {
  const server = configuration.mcpServers?.[name];
  const actualTools = await listTools(name, server);
  if (JSON.stringify(actualTools) !== JSON.stringify(expectedTools)) {
    throw new Error(
      `${name} tools mismatch: expected ${expectedTools.join(", ")}, received ${actualTools.join(", ")}`,
    );
  }
  process.stdout.write(
    `${name}: verified ${actualTools.length} tools at ${server.args[0]}\n`,
  );
}

if (expectAtbash) {
  const requireFromPlugin = createRequire(join(pluginTarget, "package.json"));
  const sdkPath = requireFromPlugin.resolve("@atbash/sdk");
  await access(sdkPath);
  const sdk = requireFromPlugin("@atbash/sdk");
  if (typeof sdk.Atbash?.fromConfig !== "function") {
    throw new Error(
      "external security SDK loaded without the expected native Atbash binding",
    );
  }
  process.stdout.write(
    "external security SDK: verified installed package and native binding\n",
  );
}
