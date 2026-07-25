import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  assertAtbashActivationReady,
  atomicReplaceDirectory,
  cleanupStaleInstallBackups,
  renderRetainedBackupWarning,
  withInstallLock,
} from "../scripts/install-lib.mjs";

const execute = promisify(execFile);

test("Atbash activation requires private process configuration before installation", () => {
  assert.throws(
    () => assertAtbashActivationReady({}),
    /ATBASH_AGENT_KEY and ATBASH_ORG_NAME/,
  );
  assert.throws(
    () =>
      assertAtbashActivationReady({
        ATBASH_AGENT_KEY: "configured",
        ATBASH_ORG_NAME: " ",
      }),
    /ATBASH_ORG_NAME/,
  );
  assert.doesNotThrow(() =>
    assertAtbashActivationReady({
      ATBASH_AGENT_KEY: "configured",
      ATBASH_ORG_NAME: "configured",
    }),
  );
});

test("locked-backup remediation distinguishes activation from stale host state", () => {
  const warning = renderRetainedBackupWarning(1);
  assert.match(warning, /active installation passed verification/i);
  assert.match(warning, /previous MCP runtime loaded/i);
  assert.match(warning, /get_runtime_info/);
  assert.match(warning, /status=current/);
  assert.match(warning, /rerun the installer/);
  assert.equal(renderRetainedBackupWarning(0), "");
});

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

test("retains a locked backup after verified activation without reporting failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "graph-install-locked-"));
  const target = join(directory, "prompt-refiner");
  const staged = join(directory, "prompt-refiner.installing");
  try {
    await mkdir(target);
    await mkdir(staged);
    await writeFile(join(target, "marker.txt"), "known-good", "utf8");
    await writeFile(join(staged, "marker.txt"), "verified-candidate", "utf8");

    const result = await atomicReplaceDirectory({
      staged,
      target,
      verify: async (installed) => {
        assert.equal(
          await readFile(join(installed, "marker.txt"), "utf8"),
          "verified-candidate",
        );
      },
      removePath: async (path, options) => {
        if (path.includes(".backup-")) {
          throw Object.assign(new Error("native module is locked"), {
            code: "EPERM",
          });
        }
        await rm(path, options);
      },
    });

    assert.equal(result.status, "activated");
    assert.equal(result.backupCleanup?.status, "retained");
    assert.equal(result.backupCleanup?.reason, "EPERM");
    assert.equal(
      await readFile(join(target, "marker.txt"), "utf8"),
      "verified-candidate",
    );
    const entries = await readdir(directory);
    assert.equal(
      entries.filter((entry) => entry.startsWith("prompt-refiner.backup-"))
        .length,
      1,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("stale cleanup removes only exact backups and retains locked directories", async () => {
  const directory = await mkdtemp(join(tmpdir(), "graph-install-cleanup-"));
  const target = join(directory, "prompt-refiner");
  const removable = join(
    directory,
    "prompt-refiner.backup-11111111-1111-4111-8111-111111111111",
  );
  const locked = join(
    directory,
    "prompt-refiner.backup-22222222-2222-4222-8222-222222222222",
  );
  const lookalike = join(directory, "prompt-refiner.backup-not-a-run-id");
  try {
    await mkdir(removable);
    await mkdir(locked);
    await mkdir(lookalike);
    const results = await cleanupStaleInstallBackups(target, {
      removePath: async (path, options) => {
        if (path === locked) {
          throw Object.assign(new Error("directory is busy"), {
            code: "EBUSY",
          });
        }
        await rm(path, options);
      },
    });

    assert.deepEqual(
      results.map(({ path, status, reason }) => ({
        name: path.split(/[\\/]/).at(-1),
        status,
        reason,
      })),
      [
        {
          name: "prompt-refiner.backup-11111111-1111-4111-8111-111111111111",
          status: "removed",
          reason: undefined,
        },
        {
          name: "prompt-refiner.backup-22222222-2222-4222-8222-222222222222",
          status: "retained",
          reason: "EBUSY",
        },
      ],
    );
    assert.deepEqual((await readdir(directory)).sort(), [
      "prompt-refiner.backup-22222222-2222-4222-8222-222222222222",
      "prompt-refiner.backup-not-a-run-id",
    ]);
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
    assert.match(
      verification.stdout,
      /prompt-refiner: verified 3 tools and current runtime 0\.4\.0/,
    );
    assert.match(
      verification.stdout,
      /graph-engineer: verified 7 tools and current runtime 0\.4\.0/,
    );
    for (const file of [
      ".cursor-plugin/plugin.json",
      "install-manifest.json",
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

test("Hermes adapter emits a credential-free config with skills and both MCP servers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "graph-install-hermes-"));
  const target = join(directory, "prompt-refiner");
  try {
    await execute(
      process.execPath,
      [
        "scripts/install.mjs",
        "--platform",
        "hermes",
        "--plugin-dir",
        target,
        "--skip-global",
      ],
      { cwd: process.cwd(), timeout: 120_000 },
    );
    const config = await readFile(join(target, "hermes.config.yaml"), "utf8");
    assert.match(config, /^skills:\n  external_dirs:/);
    assert.match(config, /\n  write_approval: true\n/);
    assert.match(config, /mcp_servers:\n  prompt-refiner:/);
    assert.match(config, /\n  graph-engineer:/);
    assert.match(config, /PROMPT_REFINER_PROVIDER: "none"/);
    assert.match(config, /GRAPHVIGIL_INSTALL_ID:/);
    assert.match(config, /GRAPHVIGIL_INSTALL_MANIFEST:/);
    assert.match(config, /resources: false/);
    assert.match(config, /prompts: false/);
    assert.doesNotMatch(config, /(API_KEY|TOKEN|PASSWORD|SECRET)/i);
    await readFile(join(target, "skills", "improve-prompt", "SKILL.md"), "utf8");
    await readFile(join(target, "skills", "engineer-graph", "SKILL.md"), "utf8");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
