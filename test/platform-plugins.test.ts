import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(resolve(path), "utf8")) as Record<string, unknown>;
}

async function runHook(
  script: string,
  input: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): Promise<Record<string, unknown>> {
  return await new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: process.cwd(),
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString("utf8")));
        return;
      }
      resolveResult(
        JSON.parse(Buffer.concat(stdout).toString("utf8")) as Record<string, unknown>,
      );
    });
    child.stdin.end(JSON.stringify(input));
  });
}

test("Cursor marketplace and plugin manifests expose rules, skills, and MCP", async () => {
  const marketplace = await json(".cursor-plugin/marketplace.json");
  const plugins = marketplace.plugins as Array<Record<string, unknown>>;
  assert.equal(marketplace.name, "autonomous-graph-engineering");
  assert.equal(plugins[0]?.source, "./plugins/prompt-refiner");

  const manifest = await json("plugins/prompt-refiner/.cursor-plugin/plugin.json");
  assert.equal(manifest.name, "prompt-refiner");
  assert.equal(manifest.displayName, "GraphVigil");
  assert.equal(manifest.rules, "./rules/");
  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.mcpServers, "./cursor.mcp.json");

  const mcp = await json("plugins/prompt-refiner/cursor.mcp.json");
  assert.deepEqual(
    Object.keys(mcp.mcpServers as Record<string, unknown>).sort(),
    ["graph-engineer", "prompt-refiner"],
  );
});

test("Copilot plugin manifest connects skills, prompt hook, and MCP", async () => {
  const marketplace = await json(".github/plugin/marketplace.json");
  const marketplacePlugins = marketplace.plugins as Array<
    Record<string, unknown>
  >;
  const marketplaceMetadata = marketplace.metadata as Record<string, unknown>;
  assert.equal(marketplaceMetadata.version, "0.3.3");
  assert.equal(marketplacePlugins[0]?.version, "0.3.3");
  assert.equal(marketplacePlugins[0]?.source, "./plugins/prompt-refiner");

  const manifest = await json("plugins/prompt-refiner/plugin.json");
  assert.equal(manifest.name, "prompt-refiner");
  assert.match(String(manifest.description), /GraphVigil/);
  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.hooks, "./hooks/copilot-hooks.json");
  assert.equal(manifest.mcpServers, "./copilot.mcp.json");

  const hooks = await json("plugins/prompt-refiner/hooks/copilot-hooks.json");
  const hookMap = hooks.hooks as Record<string, unknown[]>;
  assert.equal(hooks.version, 1);
  assert.equal(hookMap.userPromptTransformed.length, 1);
});

test("Copilot hook deterministically improves a prompt and preserves raw bypass", async () => {
  const script = resolve(
    "plugins/prompt-refiner/hooks/copilot-prompt-refiner-hook.mjs",
  );
  const env = {
    ...process.env,
    PROMPT_REFINER_RUNTIME_URL: pathToFileURL(
      resolve("packages/prompt-refiner/dist/index.js"),
    ).href,
  };
  const refinedResult = (await runHook(
    script,
    {
      prompt: "Review authentication and verify every finding.",
      cwd: resolve("test"),
    },
    env,
  )) as {
    modifiedTransformedPrompt?: string;
  };
  assert.match(refinedResult.modifiedTransformedPrompt ?? "", /Original request/);
  assert.match(refinedResult.modifiedTransformedPrompt ?? "", /Verification/);

  const raw = await runHook(
    script,
    { prompt: "!raw keep this exact", cwd: resolve("test") },
    env,
  );
  assert.deepEqual(raw, {});
});

test("Copilot hook fails closed when its installed runtime is unavailable", async () => {
  const result = await runHook(
    resolve("plugins/prompt-refiner/hooks/copilot-prompt-refiner-hook.mjs"),
    { prompt: "Delete production." },
    {
      ...process.env,
      PROMPT_REFINER_RUNTIME_URL: "file:///missing-prompt-refiner-runtime.js",
    },
  );
  assert.match(
    String(result.modifiedTransformedPrompt),
    /failed closed.*Do not act/is,
  );
});
