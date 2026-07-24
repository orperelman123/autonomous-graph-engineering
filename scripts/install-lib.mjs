import { randomUUID } from "node:crypto";
import { access, open, rename, rm } from "node:fs/promises";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function withInstallLock(target, operation) {
  const lockPath = `${target}.install.lock`;
  let handle;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        `installation lock already exists at ${lockPath}; verify no installer is running before removing a stale lock`,
      );
    }
    throw error;
  }
  try {
    return await operation();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}

export async function atomicReplaceDirectory({
  staged,
  target,
  verify = async () => {},
  renamePath = rename,
  removePath = rm,
}) {
  const backup = `${target}.backup-${randomUUID()}`;
  const hadTarget = await exists(target);
  let backedUp = false;
  let activated = false;
  try {
    if (hadTarget) {
      await renamePath(target, backup);
      backedUp = true;
    }
    await renamePath(staged, target);
    activated = true;
    await verify(target);
  } catch (error) {
    if (activated && (await exists(target))) {
      await removePath(target, { recursive: true, force: true });
    }
    if (backedUp && (await exists(backup))) {
      await renamePath(backup, target);
      backedUp = false;
    }
    throw error;
  }
  if (backedUp) {
    await removePath(backup, { recursive: true, force: true });
  }
}
