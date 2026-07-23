import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requestedIndex = process.argv.indexOf("--plugin-dir");
const requested =
  requestedIndex >= 0 ? process.argv[requestedIndex + 1] : undefined;
const pluginTarget = resolve(
  requested ?? join(homedir(), "plugins", "prompt-refiner"),
);
if (basename(pluginTarget) !== "prompt-refiner" || pluginTarget === homedir()) {
  throw new Error("plugin target must end in a dedicated prompt-refiner directory");
}

function run(command, args) {
  const windowsNpm = process.platform === "win32" && command === "npm";
  const commandLine = [command, ...args]
    .map((value) => {
      const text = String(value).replaceAll('"', '""');
      return /\s/.test(text) ? `"${text}"` : text;
    })
    .join(" ");
  execFileSync(
    windowsNpm ? process.env.ComSpec ?? "cmd.exe" : command,
    windowsNpm ? ["/d", "/s", "/c", commandLine] : args,
    { cwd: root, stdio: "inherit" },
  );
}

run("npm", ["run", "build"]);
run("npm", ["install", "-g", "file:packages/prompt-refiner"]);
run("npm", ["install", "-g", "file:packages/graph-orchestrator"]);

const temporary = `${pluginTarget}.installing-${process.pid}`;
await rm(temporary, { recursive: true, force: true });
await mkdir(dirname(pluginTarget), { recursive: true });
await cp(join(root, "plugins", "prompt-refiner"), temporary, { recursive: true });
await cp(
  join(root, "packages", "prompt-refiner", "dist"),
  join(temporary, "runtime"),
  { recursive: true },
);
await cp(
  join(root, "packages", "graph-orchestrator", "dist"),
  join(temporary, "graph-runtime"),
  { recursive: true },
);
const dependency = join(
  temporary,
  "node_modules",
  "@autonomous-graph-engineering",
  "prompt-refiner",
);
await mkdir(dependency, { recursive: true });
await cp(
  join(root, "packages", "prompt-refiner", "dist"),
  join(dependency, "dist"),
  { recursive: true },
);
const packageSource = JSON.parse(
  await readFile(join(root, "packages", "prompt-refiner", "package.json"), "utf8"),
);
await writeFile(
  join(dependency, "package.json"),
  `${JSON.stringify({
    name: packageSource.name,
    version: packageSource.version,
    type: "module",
    main: "./dist/index.js",
    exports: { ".": { import: "./dist/index.js" } },
  }, null, 2)}\n`,
  "utf8",
);
await writeFile(
  join(temporary, ".mcp.json"),
  `${JSON.stringify({
    mcpServers: {
      "prompt-refiner": {
        command: "node",
        args: [join(pluginTarget, "runtime", "mcp-server.js")],
        env: { PROMPT_REFINER_PROVIDER: "none" },
      },
      "graph-engineer": {
        command: "node",
        args: [join(pluginTarget, "graph-runtime", "mcp-server.js")],
      },
    },
  }, null, 2)}\n`,
  "utf8",
);
await rm(pluginTarget, { recursive: true, force: true });
await rename(temporary, pluginTarget);
process.stdout.write(
  `Installed CLIs and plugin bundle at ${pluginTarget}.\n` +
  "See docs/installation.md for Codex and Claude Code registration commands.\n",
);
