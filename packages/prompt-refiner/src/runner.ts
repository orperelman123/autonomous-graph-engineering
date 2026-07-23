import { spawn } from "node:child_process";
import { collectContext } from "./context.js";
import { refinePrompt } from "./provider.js";

export async function runAgent(
  agent: "codex" | "claude",
  prompt: string,
  options: { semantic?: boolean; dryRun?: boolean } = {},
): Promise<number> {
  const refined = await refinePrompt({
    prompt,
    mode: "auto",
    context: await collectContext(),
    ...(typeof options.semantic === "boolean"
      ? { semantic: options.semantic }
      : {}),
  });
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify(refined, null, 2)}\n`);
    return 0;
  }
  if (refined.status === "clarification_needed") {
    process.stderr.write(
      `Clarification required: ${refined.clarificationQuestion}\n`,
    );
    return 2;
  }
  if (refined.status === "confirmation_required") {
    process.stderr.write(
      `Confirmation required: ${refined.confirmationReason}\nUse --dry-run to inspect the execution brief, then run the underlying agent explicitly if approved.\n`,
    );
    return 3;
  }
  const command = agent;
  const args =
    agent === "codex"
      ? ["exec", refined.effectivePrompt]
      : ["-p", refined.effectivePrompt, "--output-format", "json"];
  return await new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: false,
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}
