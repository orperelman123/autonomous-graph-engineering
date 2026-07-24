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
  const commands = new Set(overrides.commands ?? ["npm", "codex", "claude"]);
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
  assert.equal(first.summary.warnings, 2);
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
});
