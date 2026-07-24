import { open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  runLiveBenchmark,
  validateLiveBenchmarkPlan,
} from "./live-provider-benchmark-lib.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function replaceFile(handle, value) {
  const bytes = Buffer.from(value, "utf8");
  await handle.truncate(0);
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      bytes.byteLength - offset,
      offset,
    );
    if (bytesWritten === 0) throw new Error("artifact write made no progress");
    offset += bytesWritten;
  }
  await handle.sync();
}

const planPath = option("--plan");
if (!planPath) {
  throw new Error("--plan <path> is required");
}
const execute = process.argv.includes("--execute");
const confirmation = option("--confirm-budget-usd");
const rawPlan = JSON.parse(await readFile(resolve(planPath), "utf8"));
const validated = validateLiveBenchmarkPlan(rawPlan);
const output = option("--output");
const target = output ? resolve(output) : undefined;
const handle = target ? await open(target, "wx", 0o600) : undefined;
try {
  if (handle) {
    await replaceFile(
      handle,
      `${JSON.stringify(
        {
          version: "1.0",
          benchmark: "live-provider-outcome",
          status: "execution_reserved",
          mode: execute ? "live" : "dry_run",
          planId: validated.plan.id,
          planSha256: validated.planSha256,
          reservedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
  }
  const report = await runLiveBenchmark({
    plan: rawPlan,
    execute,
    ...(confirmation !== undefined
      ? { confirmedBudgetUsd: Number(confirmation) }
      : {}),
  });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (handle) {
    await replaceFile(handle, serialized);
  } else {
    process.stdout.write(serialized);
  }
  process.exitCode =
    report.status === "ready" || (report.status === "completed" && report.passed)
      ? 0
      : 1;
} finally {
  if (handle) {
    await handle.close().catch(() => undefined);
  }
}
