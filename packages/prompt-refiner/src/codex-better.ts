#!/usr/bin/env node
import { runAgent } from "./runner.js";
import { parseWrapperArguments } from "./wrapper.js";

let parsed;
try {
  parsed = parseWrapperArguments(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
}
if (parsed && !parsed.prompt) {
  process.stderr.write(
    "Usage: codex-better [--semantic] [--dry-run] [--] <prompt>\n",
  );
  process.exitCode = 1;
} else if (parsed) {
  void runAgent("codex", parsed.prompt, {
    semantic:
      parsed.semantic || process.env.PROMPT_REFINER_SEMANTIC === "true",
    dryRun: parsed.dryRun,
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`${(error as Error).message}\n`);
      process.exitCode = 1;
    },
  );
}
