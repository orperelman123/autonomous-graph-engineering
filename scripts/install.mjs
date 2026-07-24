import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  atomicReplaceDirectory,
  withInstallLock,
} from "./install-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requestedIndex = process.argv.indexOf("--plugin-dir");
const requested =
  requestedIndex >= 0 ? process.argv[requestedIndex + 1] : undefined;
const platformIndex = process.argv.indexOf("--platform");
const platform =
  platformIndex >= 0 ? process.argv[platformIndex + 1] : "codex-claude";
const skipGlobal = process.argv.includes("--skip-global");
const withAtbash = process.argv.includes("--with-atbash");
const enableAtbash = process.argv.includes("--enable-atbash");
if (enableAtbash && !withAtbash) {
  throw new Error("--enable-atbash requires --with-atbash");
}
if (!["codex-claude", "cursor", "copilot"].includes(platform)) {
  throw new Error("platform must be codex-claude, cursor, or copilot");
}
const platformDefault =
  platform === "cursor"
    ? join(homedir(), ".cursor", "plugins", "local", "prompt-refiner")
    : platform === "copilot"
      ? join(homedir(), ".copilot", "plugins", "local", "prompt-refiner")
      : join(homedir(), "plugins", "prompt-refiner");
const pluginTarget = resolve(
  requested ?? platformDefault,
);
if (basename(pluginTarget) !== "prompt-refiner" || pluginTarget === homedir()) {
  throw new Error("plugin target must end in a dedicated prompt-refiner directory");
}

function run(command, args, cwd = root) {
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
    { cwd, stdio: "inherit" },
  );
}

const temporary = `${pluginTarget}.installing-${process.pid}`;
await mkdir(dirname(pluginTarget), { recursive: true });
await withInstallLock(pluginTarget, async () => {
  try {
    run("npm", ["run", "build"]);
    if (!skipGlobal) {
      run("npm", ["install", "-g", "file:packages/prompt-refiner"]);
      run("npm", ["install", "-g", "file:packages/graph-orchestrator"]);
    }

    await rm(temporary, { recursive: true, force: true });
    await cp(join(root, "plugins", "prompt-refiner"), temporary, {
      recursive: true,
    });
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
    if (withAtbash) {
      run(
        "npm",
        [
          "install",
          "--no-save",
          "--omit=dev",
          "--ignore-scripts",
          "@atbash/sdk@0.6.0",
        ],
        temporary,
      );
    }
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
      await readFile(
        join(root, "packages", "prompt-refiner", "package.json"),
        "utf8",
      ),
    );
    const graphPackageSource = JSON.parse(
      await readFile(
        join(root, "packages", "graph-orchestrator", "package.json"),
        "utf8",
      ),
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
    const installId = randomUUID();
    const installManifest = {
      schemaVersion: "1.0",
      installId,
      installedAt: new Date().toISOString(),
      platform,
      components: {
        promptRefiner: packageSource.version,
        graphEngineer: graphPackageSource.version,
      },
      atbash: {
        installed: withAtbash,
        enabled: enableAtbash,
      },
    };
    await writeFile(
      join(temporary, "install-manifest.json"),
      `${JSON.stringify(installManifest, null, 2)}\n`,
      "utf8",
    );
    const runtimeIdentity = {
      GRAPHVIGIL_INSTALL_ID: installId,
      GRAPHVIGIL_INSTALL_MANIFEST: join(
        pluginTarget,
        "install-manifest.json",
      ),
    };
    const mcpConfiguration = {
      mcpServers: {
        "prompt-refiner": {
          command: "node",
          args: [join(pluginTarget, "runtime", "mcp-server.js")],
          env: {
            PROMPT_REFINER_PROVIDER: "none",
            ...runtimeIdentity,
          },
        },
        "graph-engineer": {
          command: "node",
          args: [join(pluginTarget, "graph-runtime", "mcp-server.js")],
          env: {
            ...runtimeIdentity,
            ...(enableAtbash
              ? { GRAPH_ENGINEER_SECURITY_PROVIDER: "atbash" }
              : {}),
          },
        },
      },
    };
    for (const filename of [
      ".mcp.json",
      "cursor.mcp.json",
      "copilot.mcp.json",
    ]) {
      await writeFile(
        join(temporary, filename),
        `${JSON.stringify(mcpConfiguration, null, 2)}\n`,
        "utf8",
      );
    }
    await atomicReplaceDirectory({
      staged: temporary,
      target: pluginTarget,
      verify: async (installed) => {
        for (const required of [
          join(installed, ".mcp.json"),
          join(installed, "install-manifest.json"),
          join(installed, "runtime", "mcp-server.js"),
          join(installed, "graph-runtime", "mcp-server.js"),
        ]) {
          await readFile(required);
        }
        run(
          process.execPath,
          [
            "scripts/verify-install.mjs",
            "--plugin-dir",
            installed,
            ...(withAtbash ? ["--expect-atbash"] : []),
          ],
          root,
        );
      },
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
process.stdout.write(
  `${skipGlobal ? "Installed plugin bundle" : "Installed CLIs and plugin bundle"} at ${pluginTarget}.\n` +
  `Prepared the ${platform} adapter${withAtbash ? " with the official Atbash SDK" : ""}${enableAtbash ? " enabled" : ""}. See docs/installation.md for host registration and verification.\n` +
  "Reload each active host, then call get_runtime_info; status=current confirms the new installation is active.\n",
);
