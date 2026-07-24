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
const manifest = JSON.parse(
  await readFile(join(pluginTarget, "install-manifest.json"), "utf8"),
);
if (
  manifest?.schemaVersion !== "1.0" ||
  typeof manifest.installId !== "string" ||
  typeof manifest.components?.promptRefiner !== "string" ||
  typeof manifest.components?.graphEngineer !== "string"
) {
  throw new Error("installed GraphVigil manifest is invalid");
}

const configuration = JSON.parse(
  await readFile(join(pluginTarget, ".mcp.json"), "utf8"),
);
const expected = new Map([
  [
    "prompt-refiner",
    ["refine_prompt", "get_runtime_info", "evaluate_prompt_refiner"],
  ],
  [
    "graph-engineer",
    [
      "get_runtime_info",
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
  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "get_runtime_info", arguments: {} },
    })}\n`,
  );
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const initialized = responses.find((response) => response.id === 1);
    const listed = responses.find((response) => response.id === 2);
    const runtime = responses.find((response) => response.id === 3);
    if (initialized && listed && runtime) {
      child.kill();
      return {
        serverInfo: initialized.result?.serverInfo,
        tools: listed.result?.tools?.map((tool) => tool.name) ?? [],
        runtimeInfo: runtime.result?.structuredContent,
      };
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  child.kill();
  throw new Error(`${name} MCP server did not respond within 5 seconds`);
}

for (const [name, expectedTools] of expected) {
  const server = configuration.mcpServers?.[name];
  const { serverInfo, tools: actualTools, runtimeInfo } = await listTools(
    name,
    server,
  );
  if (JSON.stringify(actualTools) !== JSON.stringify(expectedTools)) {
    throw new Error(
      `${name} tools mismatch: expected ${expectedTools.join(", ")}, received ${actualTools.join(", ")}`,
    );
  }
  const expectedVersion =
    name === "prompt-refiner"
      ? manifest.components.promptRefiner
      : manifest.components.graphEngineer;
  if (
    serverInfo?.version !== expectedVersion ||
    runtimeInfo?.version !== expectedVersion ||
    runtimeInfo?.status !== "current" ||
    runtimeInfo?.reloadRequired !== false ||
    runtimeInfo?.bootInstallId !== manifest.installId ||
    runtimeInfo?.activeInstallId !== manifest.installId
  ) {
    throw new Error(
      `${name} runtime identity mismatch; reinstall and reload the host`,
    );
  }
  process.stdout.write(
    `${name}: verified ${actualTools.length} tools and current runtime ${expectedVersion} at ${server.args[0]}\n`,
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
