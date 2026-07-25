import { randomUUID } from "node:crypto";
import { access, open, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const RETAINABLE_BACKUP_ERRORS = new Set(["EBUSY", "ENOTEMPTY", "EPERM"]);
const BACKUP_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function assertAtbashActivationReady(
  environment = process.env,
) {
  const missing = ["ATBASH_AGENT_KEY", "ATBASH_ORG_NAME"].filter(
    (name) => !environment[name]?.trim(),
  );
  if (missing.length > 0) {
    throw new Error(
      `--enable-atbash requires non-empty ${missing.join(
        " and ",
      )} process environment variable${missing.length === 1 ? "" : "s"}; use --with-atbash without activation until onboarding is complete`,
    );
  }
}

export function renderRetainedBackupWarning(count) {
  if (!Number.isInteger(count) || count < 1) return "";
  return (
    `GraphVigil retained ${count} verified previous-installation backup${count === 1 ? "" : "s"} because Windows reported locked files. ` +
    "The active installation passed verification. A running host may still have the previous MCP runtime loaded; call get_runtime_info and reload every host until status=current, then rerun the installer to remove unlocked backups.\n"
  );
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

function retainableBackupError(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    RETAINABLE_BACKUP_ERRORS.has(error.code)
  );
}

async function removeBackup(backup, removePath) {
  try {
    await removePath(backup, { recursive: true, force: true });
    return { path: backup, status: "removed" };
  } catch (error) {
    if (!retainableBackupError(error)) throw error;
    return {
      path: backup,
      status: "retained",
      reason: error.code,
    };
  }
}

export async function cleanupStaleInstallBackups(
  target,
  {
    readDirectory = (path) => readdir(path, { withFileTypes: true }),
    removePath = rm,
  } = {},
) {
  const parent = dirname(target);
  const prefix = `${basename(target)}.backup-`;
  const entries = await readDirectory(parent);
  const backups = entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name.startsWith(prefix) &&
        BACKUP_ID_PATTERN.test(entry.name.slice(prefix.length)),
    )
    .map((entry) => join(parent, entry.name))
    .sort();
  const results = [];
  for (const backup of backups) {
    results.push(await removeBackup(backup, removePath));
  }
  return results;
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
  let backupCleanup;
  if (backedUp) {
    backupCleanup = await removeBackup(backup, removePath);
  }
  return {
    status: "activated",
    target,
    ...(backupCleanup ? { backupCleanup } : {}),
  };
}
