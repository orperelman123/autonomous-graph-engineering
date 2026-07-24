import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderQuickstartReport,
  runQuickstartJourney,
} from "./quickstart-lib.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const report = await runQuickstartJourney(repositoryRoot);

process.stdout.write(
  process.argv.includes("--json")
    ? `${JSON.stringify(report, null, 2)}\n`
    : renderQuickstartReport(report),
);
process.exitCode = report.status === "ready" ? 0 : 1;
