#!/usr/bin/env node
/**
 * Copy compiled package output into the plugin directory.
 *
 * Claude Code / Cursor / Copilot install marketplace plugins by copying the
 * git-tracked files under plugins/<name>/ — no build step runs on the consumer
 * side. plugins/prompt-refiner/hooks/prompt-refiner-hook.mjs imports
 * ../runtime/index.js, and the MCP configs point at runtime/mcp-server.js and
 * graph-runtime/mcp-server.js. If those directories are absent from the repo the
 * UserPromptSubmit hook dies with ERR_MODULE_NOT_FOUND on every prompt.
 *
 * Run after building so the vendored runtime always matches each package dist.
 */
import { cp, rm, mkdir, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const plugin = join(root, "plugins", "prompt-refiner");

const targets = [
  { from: join(root, "packages", "prompt-refiner", "dist"), to: join(plugin, "runtime") },
  { from: join(root, "packages", "graph-orchestrator", "dist"), to: join(plugin, "graph-runtime") },
];

let failed = false;
for (const { from, to } of targets) {
  try {
    await access(from);
  } catch {
    console.error(`missing build output: ${from}\n  run "npm run build" first`);
    failed = true;
    continue;
  }
  await rm(to, { recursive: true, force: true });
  await mkdir(dirname(to), { recursive: true });
  // ship only what the plugin executes at runtime: no .d.ts, no source maps
  await cp(from, to, {
    recursive: true,
    filter: (src) => !src.endsWith(".map") && !src.endsWith(".d.ts"),
  });
  console.log(`synced ${to.slice(root.length + 1)}`);
}

if (failed) process.exit(1);
