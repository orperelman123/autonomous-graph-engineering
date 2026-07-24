import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  renderDoctorReport,
  runDoctor,
} from "../src/doctor.js";

const root = resolve("fixture", "autonomous-graph-engineering");
const pluginDirectory = resolve("fixture", "plugins", "prompt-refiner");

function fixture(overrides: {
  nodeVersion?: string;
  commands?: string[];
  pluginValid?: boolean;
  pathsExist?: boolean;
} = {}) {
  const commands = new Set(
    overrides.commands ?? ["npm", "codex", "claude", "cursor-agent", "copilot"],
  );
  const pluginValid = overrides.pluginValid ?? true;
  const pathsExist = overrides.pathsExist ?? true;
  return runDoctor({
    root,
    pluginDirectory,
    nodeVersion: overrides.nodeVersion ?? "20.20.0",
    commandAvailable: (command) => commands.has(command),
    exists: async () => pathsExist,
    readJson: async (path) => {
      if (path.endsWith("package.json")) {
        return { name: "autonomous-graph-engineering" };
      }
      if (path.endsWith(".mcp.json") && pluginValid) {
        return {
          mcpServers: {
            "prompt-refiner": {
              command: "node",
              args: [join(pluginDirectory, "runtime", "mcp-server.js")],
            },
            "graph-engineer": {
              command: "node",
              args: [join(pluginDirectory, "graph-runtime", "mcp-server.js")],
            },
          },
        };
      }
      throw new Error("malformed fixture");
    },
  });
}

test("doctor fixture is deterministic and ready without provider credentials", async () => {
  const first = await fixture({ commands: ["npm"] });
  const second = await fixture({ commands: ["npm"] });
  assert.deepEqual(first, second);
  assert.equal(first.status, "ready");
  assert.equal(first.summary.failures, 0);
  assert.equal(first.summary.warnings, 4);
  assert.deepEqual(
    first.checks.map((check) => check.id),
    [
      "node-version",
      "npm-cli",
      "project-root",
      "runtime-entrypoints",
      "local-plugin",
      "codex-cli",
      "claude-cli",
      "cursor-cli",
      "copilot-cli",
    ],
  );
  assert.deepEqual(
    first.hosts.map(({ host, authentication, mcpRegistration }) => ({
      host,
      authentication,
      mcpRegistration,
    })),
    [
      { host: "codex", authentication: "unknown", mcpRegistration: "unknown" },
      { host: "claude", authentication: "unknown", mcpRegistration: "unknown" },
      { host: "cursor", authentication: "unknown", mcpRegistration: "unknown" },
      { host: "copilot", authentication: "unknown", mcpRegistration: "unknown" },
    ],
  );
});

test("doctor blocks required failures but only warns for malformed plugin state", async () => {
  const oldNode = await fixture({ nodeVersion: "18.20.0" });
  assert.equal(oldNode.status, "blocked");
  assert.equal(oldNode.summary.failures, 1);

  const malformedPlugin = await fixture({ pluginValid: false });
  assert.equal(malformedPlugin.status, "ready");
  assert.equal(malformedPlugin.summary.warnings, 1);
});

test("doctor human renderer has stable severity and remediation", async () => {
  const report = await fixture({
    commands: [],
    nodeVersion: "18.20.0",
  });
  const rendered = renderDoctorReport(report);
  assert.match(rendered, /^Autonomous Graph Engineering doctor: blocked/m);
  assert.match(rendered, /\[FAIL\] Node\.js 18\.20\.0/);
  assert.match(rendered, /\[FAIL\] npm CLI not found/);
  assert.match(rendered, /\[WARN\] codex CLI not found/);
  assert.match(rendered, /\[HOST\] cursor: auth=unknown, mcp=unknown/);
});

test("doctor reports injected host evidence without inferring it from availability", async () => {
  const report = await runDoctor({
    root,
    pluginDirectory,
    nodeVersion: "20.20.0",
    commandAvailable: (command) => ["npm", "copilot"].includes(command),
    exists: async () => true,
    readJson: async (path) => {
      if (path.endsWith("package.json")) {
        return { name: "autonomous-graph-engineering" };
      }
      return {
        mcpServers: {
          "prompt-refiner": {
            command: "node",
            args: [join(pluginDirectory, "runtime", "mcp-server.js")],
          },
          "graph-engineer": {
            command: "node",
            args: [join(pluginDirectory, "graph-runtime", "mcp-server.js")],
          },
        },
      };
    },
    hostProbe: async (host) => ({
      authentication: host === "copilot" ? "verified" : "unknown",
      mcpRegistration: host === "copilot" ? "verified" : "unknown",
      detail: "fixture evidence",
    }),
  });
  const copilot = report.hosts.find((host) => host.host === "copilot");
  assert.equal(copilot?.authentication, "verified");
  assert.equal(copilot?.mcpRegistration, "verified");
  assert.equal(
    report.hosts.find((host) => host.host === "codex")?.authentication,
    "unknown",
  );
});

test("doctor probes each CLI once without spawning shell discovery commands", async () => {
  const probes = new Map<string, number>();
  await runDoctor({
    root,
    pluginDirectory,
    nodeVersion: "20.20.0",
    commandAvailable: (command) => {
      probes.set(command, (probes.get(command) ?? 0) + 1);
      return command === "npm";
    },
    exists: async () => true,
    readJson: async (path) =>
      path.endsWith("package.json")
        ? { name: "autonomous-graph-engineering" }
        : { mcpServers: {} },
  });
  assert.deepEqual(Object.fromEntries(probes), {
    npm: 1,
    codex: 1,
    claude: 1,
    "cursor-agent": 1,
    copilot: 1,
  });
});
