#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { collectContext } from "./context.js";
import { runEvaluation } from "./evaluation.js";
import { refinePrompt } from "./provider.js";
import { runAgent } from "./runner.js";
import { startServer } from "./server.js";

function usage(): never {
  process.stderr.write(`Usage:
  prompt-refiner refine [--semantic] <prompt>
  prompt-refiner eval
  prompt-refiner serve [port]
  prompt-refiner codex [--semantic] [--dry-run] <prompt>
  prompt-refiner claude [--semantic] [--dry-run] <prompt>
  prompt-refiner refine --file <path>
`);
  process.exit(1);
}

async function main(): Promise<void> {
  const [, , command, ...rawArgs] = process.argv;
  if (!command) usage();
  const semanticIndex = rawArgs.indexOf("--semantic");
  const dryRunIndex = rawArgs.indexOf("--dry-run");
  const semantic = semanticIndex >= 0;
  const dryRun = dryRunIndex >= 0;
  const args = rawArgs.filter(
    (arg) => arg !== "--semantic" && arg !== "--dry-run",
  );

  if (command === "eval") {
    const report = runEvaluation();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.failed > 0 ? 1 : 0;
    return;
  }
  if (command === "serve") {
    const port = args[0] ? Number(args[0]) : undefined;
    const server = startServer(port ? { port } : {});
    const address = server.address();
    server.on("listening", () => {
      const resolved = server.address();
      process.stderr.write(
        `prompt-refiner listening on ${typeof resolved === "object" && resolved ? resolved.port : address}\n`,
      );
    });
    return;
  }

  let prompt: string;
  if (args[0] === "--file" && args[1]) {
    prompt = await readFile(args[1], "utf8");
  } else {
    prompt = args.join(" ");
  }
  if (!prompt.trim()) usage();

  if (command === "refine") {
    const result = await refinePrompt({
      prompt,
      context: await collectContext(),
      semantic,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === "codex" || command === "claude") {
    process.exitCode = await runAgent(command, prompt, {
      semantic,
      dryRun,
    });
    return;
  }
  usage();
}

void main().catch((error) => {
  process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
  process.exitCode = 1;
});
