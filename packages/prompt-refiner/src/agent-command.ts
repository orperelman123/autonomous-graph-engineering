import { existsSync } from "node:fs";
import { delimiter, dirname, extname, join } from "node:path";

export type SupportedAgent = "codex" | "claude";

export interface AgentCommand {
  command: string;
  prefix: string[];
}

export interface AgentCommandOptions {
  configured?: string;
  execPath?: string;
  path?: string;
  platform?: NodeJS.Platform;
}

function roots(execPath: string, pathValue: string): string[] {
  return [
    dirname(execPath),
    ...pathValue.split(delimiter).filter(Boolean),
  ].filter((value, index, values) => values.indexOf(value) === index);
}

function packageCommand(
  agent: SupportedAgent,
  root: string,
  execPath: string,
): AgentCommand | undefined {
  if (agent === "codex") {
    const entrypoint = join(
      root,
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js",
    );
    return existsSync(entrypoint)
      ? { command: execPath, prefix: [entrypoint] }
      : undefined;
  }
  const executable = join(
    root,
    "node_modules",
    "@anthropic-ai",
    "claude-code",
    "bin",
    "claude.exe",
  );
  return existsSync(executable)
    ? { command: executable, prefix: [] }
    : undefined;
}

/**
 * Resolve npm CLI shims without asking Node to execute a Windows shell script.
 * npm places extensionless POSIX shims before `.cmd` files on some PATHs, and
 * `spawn(..., { shell: false })` fails with EPERM when it selects that shim.
 */
export function resolveAgentCommand(
  agent: SupportedAgent,
  options: AgentCommandOptions = {},
): AgentCommand {
  const platform = options.platform ?? process.platform;
  const execPath = options.execPath ?? process.execPath;
  const pathValue = options.path ?? process.env.PATH ?? "";
  const configured = options.configured;

  if (configured) {
    const extension = extname(configured).toLowerCase();
    if ([".js", ".cjs", ".mjs"].includes(extension)) {
      return { command: execPath, prefix: [configured] };
    }
    if (platform !== "win32" || extension === ".exe") {
      return { command: configured, prefix: [] };
    }
    const resolved = packageCommand(agent, dirname(configured), execPath);
    if (resolved) return resolved;
    throw new Error(
      `${agent.toUpperCase()}_EXECUTABLE must point to a native .exe or JavaScript entrypoint on Windows`,
    );
  }

  if (platform !== "win32") {
    return { command: agent, prefix: [] };
  }

  const searchRoots = roots(execPath, pathValue);
  for (const root of searchRoots) {
    const resolved = packageCommand(agent, root, execPath);
    if (resolved) return resolved;
  }
  for (const root of searchRoots) {
    const executable = join(root, `${agent}.exe`);
    if (existsSync(executable)) {
      return { command: executable, prefix: [] };
    }
  }
  throw new Error(
    `Unable to resolve a safe Windows ${agent} CLI entrypoint; install the CLI or set ${agent.toUpperCase()}_EXECUTABLE to its native .exe or JavaScript entrypoint`,
  );
}
