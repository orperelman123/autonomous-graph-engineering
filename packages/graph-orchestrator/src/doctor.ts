import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface DoctorCheck {
  id: string;
  required: boolean;
  passed: boolean;
  message: string;
  remediation?: string;
}

export interface DoctorReport {
  version: "1.0";
  status: "ready" | "blocked";
  root: string;
  pluginDirectory: string;
  checks: DoctorCheck[];
  summary: {
    passed: number;
    warnings: number;
    failures: number;
  };
}

export interface DoctorOptions {
  root?: string;
  pluginDirectory?: string;
  nodeVersion?: string;
  exists?: (path: string) => Promise<boolean>;
  readJson?: (path: string) => Promise<unknown>;
  commandAvailable?: (command: string) => boolean;
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function parseJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function executableAvailable(command: string): boolean {
  const probe =
    process.platform === "win32"
      ? spawnSync("where.exe", [command], {
          stdio: "ignore",
          timeout: 2_000,
          maxBuffer: 4_096,
        })
      : spawnSync("sh", ["-lc", `command -v "${command}"`], {
          stdio: "ignore",
          timeout: 2_000,
          maxBuffer: 4_096,
        });
  return probe.status === 0;
}

function check(
  id: string,
  required: boolean,
  passed: boolean,
  message: string,
  remediation?: string,
): DoctorCheck {
  return {
    id,
    required,
    passed,
    message,
    ...(passed || !remediation ? {} : { remediation }),
  };
}

export async function runDoctor(
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const root = resolve(options.root ?? packageRoot);
  const pluginDirectory = resolve(
    options.pluginDirectory ?? join(homedir(), "plugins", "prompt-refiner"),
  );
  if (basename(pluginDirectory) !== "prompt-refiner") {
    throw new Error("plugin directory must end in prompt-refiner");
  }
  const exists = options.exists ?? pathExists;
  const readJson = options.readJson ?? parseJson;
  const commandAvailable = options.commandAvailable ?? executableAvailable;
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const checks: DoctorCheck[] = [];

  const nodeMajor = Number(nodeVersion.split(".")[0]);
  checks.push(
    check(
      "node-version",
      true,
      nodeMajor >= 20,
      `Node.js ${nodeVersion}`,
      "Install Node.js 20 or newer.",
    ),
  );
  checks.push(
    check(
      "npm-cli",
      true,
      commandAvailable("npm"),
      commandAvailable("npm") ? "npm CLI is available" : "npm CLI not found",
      "Install npm and ensure it is on PATH.",
    ),
  );

  let manifestName: string | undefined;
  try {
    const manifest = (await readJson(join(root, "package.json"))) as {
      name?: unknown;
    };
    if (typeof manifest?.name === "string") manifestName = manifest.name;
  } catch {
    manifestName = undefined;
  }
  const repositoryMode = manifestName === "autonomous-graph-engineering";
  const packageMode =
    manifestName === "@autonomous-graph-engineering/graph-engineer";
  checks.push(
    check(
      "project-root",
      true,
      repositoryMode || packageMode,
      repositoryMode || packageMode
        ? `Graph Engineer detected at ${root}`
        : "Graph Engineer package or repository not detected",
      "Run doctor from the repository or installed Graph Engineer package.",
    ),
  );

  const entrypoints = repositoryMode
    ? [
        join(root, "packages", "prompt-refiner", "dist", "cli.js"),
        join(root, "packages", "prompt-refiner", "dist", "mcp-server.js"),
        join(root, "packages", "graph-orchestrator", "dist", "cli.js"),
        join(root, "packages", "graph-orchestrator", "dist", "mcp-server.js"),
      ]
    : [join(root, "dist", "cli.js"), join(root, "dist", "mcp-server.js")];
  const buildReady = (
    await Promise.all(entrypoints.map((path) => exists(path)))
  ).every(Boolean);
  checks.push(
    check(
      "runtime-entrypoints",
      true,
      buildReady,
      buildReady
        ? "Required CLI and MCP entrypoints exist"
        : "Required build entrypoints are missing",
      repositoryMode ? "Run npm run build." : "Reinstall Graph Engineer.",
    ),
  );

  const pluginConfig = join(pluginDirectory, ".mcp.json");
  let installedReady = false;
  try {
    const configuration = (await readJson(pluginConfig)) as {
      mcpServers?: Record<
        string,
        { command?: unknown; args?: unknown; env?: unknown }
      >;
    };
    const promptServer = configuration.mcpServers?.["prompt-refiner"];
    const graphServer = configuration.mcpServers?.["graph-engineer"];
    const servers = [promptServer, graphServer];
    const paths = servers.map((server) =>
      Array.isArray(server?.args) && typeof server.args[0] === "string"
        ? server.args[0]
        : undefined,
    );
    installedReady =
      servers.every((server) => server?.command === "node") &&
      paths.every((path) => typeof path === "string") &&
      (
        await Promise.all(
          paths.map((path) =>
            typeof path === "string" ? exists(path) : Promise.resolve(false),
          ),
        )
      ).every(Boolean);
  } catch {
    installedReady = false;
  }
  checks.push(
    check(
      "local-plugin",
      false,
      installedReady,
      installedReady
        ? `Installed plugin is complete at ${pluginDirectory}`
        : `Installed plugin is missing or incomplete at ${pluginDirectory}`,
      "Run npm run install:local, then npm run verify:install.",
    ),
  );

  for (const command of ["codex", "claude"]) {
    const available = commandAvailable(command);
    checks.push(
      check(
        `${command}-cli`,
        false,
        available,
        available ? `${command} CLI is available` : `${command} CLI not found`,
        `Install and authenticate the ${command} CLI if you want to use that executor.`,
      ),
    );
  }

  const requiredFailures = checks.filter(
    (item) => item.required && !item.passed,
  );
  const warnings = checks.filter((item) => !item.required && !item.passed);
  return {
    version: "1.0",
    status: requiredFailures.length === 0 ? "ready" : "blocked",
    root,
    pluginDirectory,
    checks,
    summary: {
      passed: checks.filter((item) => item.passed).length,
      warnings: warnings.length,
      failures: requiredFailures.length,
    },
  };
}

export function renderDoctorReport(report: DoctorReport): string {
  const lines = [`Autonomous Graph Engineering doctor: ${report.status}`];
  for (const item of report.checks) {
    const marker = item.passed ? "PASS" : item.required ? "FAIL" : "WARN";
    lines.push(`[${marker}] ${item.message}`);
    if (item.remediation) lines.push(`       ${item.remediation}`);
  }
  lines.push(
    `${report.summary.passed} passed, ${report.summary.warnings} warnings, ${report.summary.failures} failures`,
  );
  return `${lines.join("\n")}\n`;
}
