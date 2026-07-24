import {
  renderDoctorReport,
  runDoctor,
} from "../packages/graph-orchestrator/dist/doctor.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const report = await runDoctor({
  root: argument("--root") ?? repositoryRoot,
  pluginDirectory: argument("--plugin-dir"),
});
process.stdout.write(
  process.argv.includes("--json")
    ? `${JSON.stringify(report, null, 2)}\n`
    : renderDoctorReport(report),
);
process.exitCode = report.status === "ready" ? 0 : 1;
