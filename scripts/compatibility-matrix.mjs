import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  assertCompatibilityMatrix,
  evaluateCompatibilityMatrix,
} from "./compatibility-matrix-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = join(root, "compatibility", "host-matrix.v1.json");
const fixtureText = await readFile(fixturePath, "utf8");
const matrix = JSON.parse(fixtureText);
const schema = JSON.parse(
  await readFile(
    join(root, "schemas", "host-compatibility-matrix.schema.json"),
    "utf8",
  ),
);
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
if (!validate(matrix)) {
  throw new Error(
    `host compatibility matrix failed its public schema: ${JSON.stringify(validate.errors)}`,
  );
}
assertCompatibilityMatrix(matrix);
const cases = await evaluateCompatibilityMatrix(matrix, root);
const report = {
  version: "1.0",
  benchmark: "offline-host-contract-compatibility",
  fixture: {
    path: "compatibility/host-matrix.v1.json",
    sha256: createHash("sha256").update(fixtureText).digest("hex"),
  },
  scope: matrix.scope,
  passed: cases.every((testCase) => testCase.passed),
  cases,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.passed ? 0 : 1;
