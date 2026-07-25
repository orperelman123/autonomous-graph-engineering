import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  verifyCommunityTemplates,
} from "./community-template-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const report = await verifyCommunityTemplates({
  directory: join(root, "templates"),
  root,
});
const reportSchema = JSON.parse(
  await readFile(
    join(root, "schemas", "community-template-report.schema.json"),
    "utf8",
  ),
);
const validateReport = new Ajv2020({
  allErrors: true,
  strict: true,
}).compile(reportSchema);
if (!validateReport(report)) {
  throw new Error(
    `community template report failed its public schema: ${JSON.stringify(
      validateReport.errors,
    )}`,
  );
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.passed ? 0 : 1;
