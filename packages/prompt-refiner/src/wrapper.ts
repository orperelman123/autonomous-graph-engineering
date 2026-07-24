export interface WrapperArguments {
  prompt: string;
  semantic: boolean;
  dryRun: boolean;
}

export function parseWrapperArguments(args: string[]): WrapperArguments {
  let semantic = false;
  let dryRun = false;
  let optionsEnded = false;
  const prompt: string[] = [];
  for (const arg of args) {
    if (!optionsEnded && arg === "--") {
      optionsEnded = true;
    } else if (!optionsEnded && arg === "--semantic") {
      semantic = true;
    } else if (!optionsEnded && arg === "--dry-run") {
      dryRun = true;
    } else if (!optionsEnded && arg.startsWith("--")) {
      throw new Error(`unsupported wrapper option: ${arg}`);
    } else {
      prompt.push(arg);
    }
  }
  return {
    prompt: prompt.join(" ").trim(),
    semantic,
    dryRun,
  };
}
