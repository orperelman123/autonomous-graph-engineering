import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getRuntimeInfo } from "../src/runtime-info.js";

function manifest(installId: string, version = "0.3.3"): string {
  return JSON.stringify({
    schemaVersion: "1.0",
    installId,
    components: {
      promptRefiner: version,
      graphEngineer: version,
    },
  });
}

test("reports unmanaged source runtimes without requiring reload", async () => {
  assert.deepEqual(
    await getRuntimeInfo("prompt-refiner", "0.3.3", {
      installId: undefined,
      manifestPath: undefined,
    }),
    {
      component: "prompt-refiner",
      version: "0.3.3",
      status: "unmanaged",
      reloadRequired: false,
      managedInstallation: false,
      bootInstallId: null,
      activeInstallId: null,
      installedVersion: null,
    },
  );
});

test("detects a stale host process after atomic plugin replacement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "runtime-info-"));
  const manifestPath = join(directory, "install-manifest.json");
  const first = "11111111-1111-4111-8111-111111111111";
  const second = "22222222-2222-4222-8222-222222222222";
  try {
    await writeFile(manifestPath, manifest(first), "utf8");
    const current = await getRuntimeInfo("graph-engineer", "0.3.3", {
      installId: first,
      manifestPath,
    });
    assert.equal(current.status, "current");
    assert.equal(current.reloadRequired, false);

    await writeFile(manifestPath, manifest(second), "utf8");
    const stale = await getRuntimeInfo("graph-engineer", "0.3.3", {
      installId: first,
      manifestPath,
    });
    assert.equal(stale.status, "reload_required");
    assert.equal(stale.reloadRequired, true);
    assert.equal(stale.bootInstallId, first);
    assert.equal(stale.activeInstallId, second);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fails closed for a missing or malformed managed manifest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "runtime-info-invalid-"));
  const manifestPath = join(directory, "install-manifest.json");
  try {
    await writeFile(manifestPath, "{}", "utf8");
    const info = await getRuntimeInfo("prompt-refiner", "0.3.3", {
      installId: "11111111-1111-4111-8111-111111111111",
      manifestPath,
    });
    assert.equal(info.status, "invalid_manifest");
    assert.equal(info.reloadRequired, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
