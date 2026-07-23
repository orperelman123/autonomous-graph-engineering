import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  AgentExecutionRequest,
  AgentExecutionResult,
  GraphExecutor,
} from "./types.js";

function renderPrompt(request: AgentExecutionRequest): string {
  return [
    request.prompt,
    "",
    "NODE INPUT:",
    JSON.stringify(request.input),
    ...(request.outputSchema
      ? ["", "OUTPUT SCHEMA:", JSON.stringify(request.outputSchema)]
      : []),
    "",
    "Return only the requested result. Preserve scope and permissions.",
  ].join("\n");
}

function codexArgs(request: AgentExecutionRequest): string[] {
  const sandbox =
    request.permission === "write" ||
    request.permission === "external" ||
    request.permission === "destructive"
      ? "workspace-write"
      : "read-only";
  return [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--sandbox",
    sandbox,
    "--json",
    renderPrompt(request),
  ];
}

function codexCommand(): { command: string; prefix: string[] } {
  const configured = process.env.CODEX_EXECUTABLE;
  if (configured) {
    return configured.endsWith(".js")
      ? { command: process.execPath, prefix: [configured] }
      : { command: configured, prefix: [] };
  }
  if (process.platform === "win32") {
    const entrypoint = join(
      dirname(process.execPath),
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js",
    );
    if (existsSync(entrypoint)) {
      return { command: process.execPath, prefix: [entrypoint] };
    }
  }
  return { command: "codex", prefix: [] };
}

function claudeArgs(request: AgentExecutionRequest): string[] {
  const permissionMode =
    request.permission === "none" || request.permission === "read"
      ? "plan"
      : "acceptEdits";
  return [
    "-p",
    renderPrompt(request),
    "--output-format",
    "json",
    "--max-turns",
    "10",
    "--permission-mode",
    permissionMode,
    "--setting-sources",
    "project",
    "--disable-slash-commands",
    "--strict-mcp-config",
    "--no-chrome",
    "--no-session-persistence",
    ...(permissionMode === "plan"
      ? ["--tools", "Read,Glob,Grep"]
      : []),
  ];
}

function claudeCommand(): { command: string; prefix: string[] } {
  const configured = process.env.CLAUDE_EXECUTABLE;
  if (configured) {
    return configured.endsWith(".js") || configured.endsWith(".cjs")
      ? { command: process.execPath, prefix: [configured] }
      : { command: configured, prefix: [] };
  }
  if (process.platform === "win32") {
    const executable = join(
      dirname(process.execPath),
      "node_modules",
      "@anthropic-ai",
      "claude-code",
      "bin",
      "claude.exe",
    );
    if (existsSync(executable)) {
      return { command: executable, prefix: [] };
    }
  }
  return { command: "claude", prefix: [] };
}

async function spawnCapture(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      detached: process.platform !== "win32",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const configuredLimit = Number(
      process.env.GRAPH_ENGINEER_MAX_OUTPUT_BYTES ?? 8 * 1024 * 1024,
    );
    const maxOutputBytes =
      Number.isFinite(configuredLimit) && configuredLimit > 0
        ? Math.floor(configuredLimit)
        : 8 * 1024 * 1024;
    let capturedBytes = 0;
    let terminating = false;
    const terminateTree = async (): Promise<void> => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        const taskkillCode = await new Promise<number | null>(
          (resolveTermination) => {
          const killer = spawn(
            "taskkill.exe",
            ["/PID", String(child.pid), "/T", "/F"],
            { windowsHide: true, stdio: "ignore" },
          );
            killer.once("exit", (code) => resolveTermination(code));
            killer.once("error", () => resolveTermination(null));
          },
        );
        if (taskkillCode === 0) return;
        const script = [
          `$root = ${String(child.pid)}`,
          "$all = @(Get-CimInstance Win32_Process)",
          "$ids = [System.Collections.Generic.List[int]]::new()",
          "$queue = [System.Collections.Generic.Queue[int]]::new()",
          "$queue.Enqueue($root)",
          "while ($queue.Count -gt 0) {",
          "  $parent = $queue.Dequeue()",
          "  foreach ($p in @($all | Where-Object ParentProcessId -eq $parent)) {",
          "    $ids.Add([int]$p.ProcessId)",
          "    $queue.Enqueue([int]$p.ProcessId)",
          "  }",
          "}",
          "$targets = @($ids.ToArray()) + @($root)",
          "[array]::Reverse($targets)",
          "foreach ($id in $targets) {",
          "  Stop-Process -Id $id -Force -ErrorAction SilentlyContinue",
          "}",
          "Start-Sleep -Milliseconds 100",
          "$remaining = @(Get-Process -Id $targets -ErrorAction SilentlyContinue)",
          "if ($remaining.Count -gt 0) { exit 1 }",
        ].join("; ");
        const fallbackCode = await new Promise<number | null>(
          (resolveTermination) => {
            const killer = spawn(
              "powershell.exe",
              ["-NoProfile", "-NonInteractive", "-Command", script],
              { windowsHide: true, stdio: "ignore" },
            );
            killer.once("exit", (code) => resolveTermination(code));
            killer.once("error", () => resolveTermination(null));
          },
        );
        if (fallbackCode !== 0) {
          child.kill();
          throw new Error(
            `Windows process-tree cleanup failed (taskkill=${String(taskkillCode)}, fallback=${String(fallbackCode)})`,
          );
        }
        return;
      }
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    };
    const failAndTerminate = (message: string): void => {
      if (terminating) return;
      terminating = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      void terminateTree()
        .then(() => reject(new Error(message)))
        .catch((error) =>
          reject(
            new Error(
              `${message}; process-tree cleanup failed: ${(error as Error).message}`,
            ),
          ),
        );
    };
    const capture = (target: Buffer[], chunk: unknown): void => {
      if (terminating) return;
      const value = Buffer.from(chunk as Uint8Array);
      capturedBytes += value.length;
      if (capturedBytes > maxOutputBytes) {
        failAndTerminate(
          `executor output exceeded ${maxOutputBytes} byte limit`,
        );
        return;
      }
      target.push(value);
    };
    child.stdout.on("data", (chunk) => capture(stdout, chunk));
    child.stderr.on("data", (chunk) => capture(stderr, chunk));
    const onAbort = (): void => {
      failAndTerminate(`${command} execution aborted`);
    };
    const timeout = setTimeout(() => {
      failAndTerminate(`${command} execution timed out`);
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    child.on("error", (error) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      if (terminating) return;
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      if (terminating) return;
      resolvePromise({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        code: code ?? 1,
      });
    });
  });
}

function maybeJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) {
      try {
        return JSON.parse(fenced);
      } catch {}
    }
    return trimmed;
  }
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function parseCodexJsonl(stdout: string): AgentExecutionResult {
  const events = stdout
    .split(/\r?\n/)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    })
    .filter((event): event is Record<string, unknown> => Boolean(event));
  const message = [...events].reverse().find((event) => {
    const item = event.item as Record<string, unknown> | undefined;
    return (
      event.type === "item.completed" &&
      item?.type === "agent_message" &&
      typeof item.text === "string"
    );
  });
  const item = message?.item as Record<string, unknown> | undefined;
  const completed = [...events]
    .reverse()
    .find((event) => event.type === "turn.completed");
  const rawUsage = completed?.usage as Record<string, unknown> | undefined;
  const inputTokens = finiteNumber(rawUsage?.input_tokens);
  const cachedInputTokens = finiteNumber(rawUsage?.cached_input_tokens);
  const outputTokens = finiteNumber(rawUsage?.output_tokens);
  const reasoningOutputTokens = finiteNumber(
    rawUsage?.reasoning_output_tokens,
  );
  const usage = rawUsage
    ? {
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
        ...(reasoningOutputTokens !== undefined
          ? { reasoningOutputTokens }
          : {}),
      }
    : undefined;
  return {
    output: maybeJson(typeof item?.text === "string" ? item.text : stdout),
    ...(usage && Object.keys(usage).length > 0 ? { usage } : {}),
  };
}

export function parseClaudeEnvelope(stdout: string): AgentExecutionResult {
  const envelope = maybeJson(stdout) as
    | {
        result?: string;
        total_cost_usd?: number;
        usage?: Record<string, unknown>;
      }
    | string;
  if (typeof envelope === "string") return { output: envelope };
  const rawUsage = envelope.usage;
  const uncachedInputTokens = finiteNumber(rawUsage?.input_tokens);
  const cachedInputTokens = finiteNumber(rawUsage?.cache_read_input_tokens);
  const cacheCreationInputTokens = finiteNumber(
    rawUsage?.cache_creation_input_tokens,
  );
  const inputTokens =
    uncachedInputTokens !== undefined ||
    cachedInputTokens !== undefined ||
    cacheCreationInputTokens !== undefined
      ? (uncachedInputTokens ?? 0) +
        (cachedInputTokens ?? 0) +
        (cacheCreationInputTokens ?? 0)
      : undefined;
  const outputTokens = finiteNumber(rawUsage?.output_tokens);
  const costUsd = finiteNumber(envelope.total_cost_usd);
  const usage = {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(cacheCreationInputTokens !== undefined
      ? { cacheCreationInputTokens }
      : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
  };
  return {
    output: maybeJson(envelope.result ?? ""),
    ...(Object.keys(usage).length > 0 ? { usage } : {}),
  };
}

export class CodexCliExecutor implements GraphExecutor {
  readonly name = "codex";

  async execute(
    request: AgentExecutionRequest,
  ): Promise<AgentExecutionResult> {
    const executable = codexCommand();
    const output = await spawnCapture(
      executable.command,
      [...executable.prefix, ...codexArgs(request)],
      request.cwd,
      request.timeoutMs,
      request.signal,
    );
    if (output.code !== 0) {
      const diagnostic =
        output.stderr.trim() ||
        output.stdout.slice(-2_000).trim() ||
        "no subprocess diagnostics";
      throw new Error(
        `Codex node failed (${output.code}): ${diagnostic}`,
      );
    }
    return parseCodexJsonl(output.stdout);
  }
}

export class ClaudeCliExecutor implements GraphExecutor {
  readonly name = "claude";

  async execute(
    request: AgentExecutionRequest,
  ): Promise<AgentExecutionResult> {
    const executable = claudeCommand();
    const output = await spawnCapture(
      executable.command,
      [...executable.prefix, ...claudeArgs(request)],
      request.cwd,
      request.timeoutMs,
      request.signal,
    );
    if (output.code !== 0) {
      const diagnostic =
        output.stderr.trim() ||
        output.stdout.slice(-2_000).trim() ||
        "no subprocess diagnostics";
      throw new Error(
        `Claude node failed (${output.code}): ${diagnostic}`,
      );
    }
    return parseClaudeEnvelope(output.stdout);
  }
}

export class LocalEchoExecutor implements GraphExecutor {
  readonly name = "local";

  async execute(
    request: AgentExecutionRequest,
  ): Promise<AgentExecutionResult> {
    if (/decompose/i.test(request.prompt)) {
      return {
        output: {
          items: [
            { id: "item-1", task: String(request.input || request.prompt) },
          ],
        },
      };
    }
    if (/accepted:boolean|Evaluate the final|Verify the candidate/i.test(request.prompt)) {
      return { output: { accepted: true, reasons: [] } };
    }
    return {
      output: {
        nodeId: request.nodeId,
        completed: true,
        input: request.input,
      },
    };
  }
}
