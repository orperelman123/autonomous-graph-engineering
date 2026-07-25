import { join } from "node:path";

function quote(value) {
  return JSON.stringify(String(value));
}

export function createHermesConfiguration({
  pluginTarget,
  runtimeIdentity,
  enableAtbash = false,
}) {
  return {
    skills: {
      external_dirs: [join(pluginTarget, "skills")],
      write_approval: true,
    },
    mcp_servers: {
      "prompt-refiner": {
        command: "node",
        args: [join(pluginTarget, "runtime", "mcp-server.js")],
        env: {
          PROMPT_REFINER_PROVIDER: "none",
          ...runtimeIdentity,
        },
        tools: {
          resources: false,
          prompts: false,
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
        tools: {
          resources: false,
          prompts: false,
        },
      },
    },
  };
}

export function renderHermesConfiguration(configuration) {
  const lines = ["skills:", "  external_dirs:"];
  for (const directory of configuration.skills.external_dirs) {
    lines.push(`    - ${quote(directory)}`);
  }
  lines.push(`  write_approval: ${configuration.skills.write_approval}`);
  lines.push("mcp_servers:");
  for (const [name, server] of Object.entries(configuration.mcp_servers)) {
    lines.push(
      `  ${name}:`,
      `    command: ${quote(server.command)}`,
      "    args:",
    );
    for (const argument of server.args) {
      lines.push(`      - ${quote(argument)}`);
    }
    lines.push("    env:");
    for (const [key, value] of Object.entries(server.env)) {
      lines.push(`      ${key}: ${quote(value)}`);
    }
    lines.push(
      "    tools:",
      `      resources: ${server.tools.resources}`,
      `      prompts: ${server.tools.prompts}`,
    );
  }
  return `${lines.join("\n")}\n`;
}
