import { open, readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import {
  runLiveBenchmark,
  validateLiveBenchmarkPlan,
} from "./live-provider-benchmark-lib.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const planPath = option("--plan");
if (!planPath) {
  throw new Error("--plan <path> is required");
}
const execute = process.argv.includes("--execute");
const confirmation = option("--confirm-budget-usd");
const rawPlan = JSON.parse(await readFile(resolve(planPath), "utf8"));
validateLiveBenchmarkPlan(rawPlan);
const output = option("--output");
const target = output ? resolve(output) : undefined;
const handle = target ? await open(target, "wx", 0o600) : undefined;
try {
  const report = await runLiveBenchmark({
    plan: rawPlan,
    execute,
    ...(confirmation !== undefined
      ? { confirmedBudgetUsd: Number(confirmation) }
      : {}),
  });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (handle) {
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
  } else {
    process.stdout.write(serialized);
  }
  process.exitCode =
    report.status === "ready" || (report.status === "completed" && report.passed)
      ? 0
      : 1;
} catch (error) {
  if (handle && target) {
    await handle.close();
    await unlink(target);
  }
  throw error;
} finally {
  if (handle) {
    await handle.close().catch(() => undefined);
  }
}
