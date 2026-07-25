import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  collectGithubReleaseSnapshot,
  evaluateGithubReleaseGate,
} from "./github-release-gate-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  return [
    "Usage:",
    "  npm run release-gate -- --snapshot <file> --repo <owner/name> --candidate-branch <branch> --candidate-commit <sha> --version <x.y.z>",
    "  npm run release-gate -- --live --repo <owner/name> --candidate-branch <branch> --candidate-commit <sha> --version <x.y.z>",
    "",
    "--live performs authenticated GitHub GET requests only.",
  ].join("\n");
}

function parseArguments(argv) {
  const values = {};
  let live = false;
  let pretty = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--live") {
      live = true;
      continue;
    }
    if (argument === "--pretty") {
      pretty = true;
      continue;
    }
    if (argument === "--help") {
      return { help: true };
    }
    if (
      [
        "--snapshot",
        "--repo",
        "--candidate-branch",
        "--candidate-commit",
        "--version",
      ].includes(argument)
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      values[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  if (live === Boolean(values.snapshot)) {
    throw new Error("choose exactly one of --live or --snapshot");
  }
  for (const name of ["repo", "candidate-branch", "candidate-commit", "version"]) {
    if (!values[name]) {
      throw new Error(`--${name} is required`);
    }
  }
  return { live, pretty, values };
}

const parsed = parseArguments(process.argv.slice(2));
if (parsed.help) {
  process.stdout.write(`${usage()}\n`);
  process.exit(0);
}

const request = {
  repository: parsed.values.repo,
  candidateBranch: parsed.values["candidate-branch"],
  candidateCommit: parsed.values["candidate-commit"],
  version: parsed.values.version,
};
const snapshot = parsed.live
  ? await collectGithubReleaseSnapshot(request)
  : JSON.parse(
      await readFile(resolve(parsed.values.snapshot), "utf8"),
    );
const report = evaluateGithubReleaseGate(snapshot, request);
const schema = JSON.parse(
  await readFile(
    join(root, "schemas", "github-release-gate-report.schema.json"),
    "utf8",
  ),
);
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
if (!validate(report)) {
  throw new Error(
    `GitHub release-gate report failed its public schema: ${JSON.stringify(validate.errors)}`,
  );
}
process.stdout.write(
  `${JSON.stringify(report, null, parsed.pretty ? 2 : undefined)}\n`,
);
process.exitCode = report.passed ? 0 : 1;
