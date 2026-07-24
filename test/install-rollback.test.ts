import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  atomicReplaceDirectory,
  withInstallLock,
} from "../scripts/install-lib.mjs";

const execute = promisify(execFile);

test("restores the previous installation when post-activation verification fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "graph-install-rollback-"));
  const target = join(directory, "prompt-refiner");
  const staged = join(directory, "prompt-refiner.installing");
  try {
    await mkdir(target);
    await mkdir(staged);
    await writeFile(join(target, "marker.txt"), "known-good", "utf8");
    await writeFile(join(staged, "marker.txt"), "candidate", "utf8");

    await assert.rejects(
      atomicReplaceDirectory({
        staged,
        target,
        verify: async () => {
          throw new Error("injected verification failure");
        },
      }),
      /injected verification failure/,
    );

    assert.equal(await readFile(join(target, "marker.txt"), "utf8"), "known-good");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("serializes installers with an atomic lock", async () => {
  const directory = await mkdtemp(join(tmpdir(), "graph-install-lock-"));
  const target = join(directory, "prompt-refiner");
  let release;
  const blocker = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const first = withInstallLock(target, async () => blocker);
    await new Promise((resolve) => setTimeout(resolve, 25));
    await assert.rejects(
      withInstallLock(target, async () => {}),
      /installation lock already exists/,
    );
    release?.();
    await first;
  } finally {
    release?.();
    await rm(directory, { recursive: true, force: true });
  }
});

test("clean local adapter bundle starts both installed MCP servers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "graph-install-e2e-"));
  const target = join(directory, "prompt-refiner");
  try {
    await execute(
      process.execPath,
      [
        "scripts/install.mjs",
        "--platform",
        "cursor",
        "--plugin-dir",
        target,
        "--skip-global",
      ],
      { cwd: process.cwd(), timeout: 120_000 },
    );
    const verification = await execute(
      process.execPath,
      ["scripts/verify-install.mjs", "--plugin-dir", target],
      { cwd: process.cwd(), timeout: 30_000 },
    );
    assert.match(verification.stdout, /prompt-refiner: verified 2 tools/);
    assert.match(verification.stdout, /graph-engineer: verified 6 tools/);
    for (const file of [
      ".cursor-plugin/plugin.json",
      "plugin.json",
      "cursor.mcp.json",
      "copilot.mcp.json",
    ]) {
      await readFile(join(target, file), "utf8");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
