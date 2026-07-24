import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { resolveAgentCommand } from "../src/agent-command.js";

test("resolves Windows npm shims to safe package entrypoints", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-command-"));
  const codexEntrypoint = join(
    root,
    "node_modules",
    "@openai",
    "codex",
    "bin",
    "codex.js",
  );
  const claudeExecutable = join(
    root,
    "node_modules",
    "@anthropic-ai",
    "claude-code",
    "bin",
    "claude.exe",
  );
  await mkdir(dirname(codexEntrypoint), { recursive: true });
  await mkdir(dirname(claudeExecutable), { recursive: true });
  await writeFile(codexEntrypoint, "", "utf8");
  await writeFile(claudeExecutable, "", "utf8");
  const execPath = join(root, "node.exe");

  try {
    assert.deepEqual(
      resolveAgentCommand("codex", {
        configured: join(root, "codex.cmd"),
        execPath,
        path: root,
        platform: "win32",
      }),
      { command: execPath, prefix: [codexEntrypoint] },
    );
    assert.deepEqual(
      resolveAgentCommand("claude", {
        execPath,
        path: root,
        platform: "win32",
      }),
      { command: claudeExecutable, prefix: [] },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects unresolved Windows shell shims", () => {
  assert.throws(
    () =>
      resolveAgentCommand("codex", {
        configured: "C:\\missing\\codex.cmd",
        execPath: "C:\\node\\node.exe",
        path: "",
        platform: "win32",
      }),
    /native \.exe or JavaScript entrypoint/,
  );
});
