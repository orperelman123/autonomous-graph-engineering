# Installation

The repository supports three layers: standalone CLIs, MCP servers, and a shared
Codex/Claude plugin bundle. Start with the local installer because it builds the
TypeScript packages and gives the plugin absolute runtime paths.

## Requirements

- Node.js 20 or newer
- npm
- Git
- Optional: authenticated `codex` and `claude` CLIs for model-backed graph nodes

## Build and verify

```bash
git clone https://github.com/orperelman123/autonomous-graph-engineering.git
cd autonomous-graph-engineering
npm ci
npm run check
npm run install:local
```

The installer:

1. builds both packages;
2. installs `prompt-refiner` and `graph-engineer` globally;
3. creates a self-contained plugin at `~/plugins/prompt-refiner`;
4. generates that installed plugin's `.mcp.json` with absolute runtime paths.

Use `npm run install:local -- --plugin-dir <absolute-path-ending-in-prompt-refiner>`
to choose another target.

## Codex

For the GitHub marketplace source:

```bash
codex plugin marketplace add orperelman123/autonomous-graph-engineering --ref main
codex plugin add prompt-refiner@autonomous-graph-engineering
```

This installs the portable skills and hooks from the repository. Run
`npm run install:local` first when you also want the local MCP runtimes.

During repository development, add the checked-out marketplace instead:

```bash
codex plugin marketplace add /absolute/path/to/autonomous-graph-engineering
codex plugin add prompt-refiner@autonomous-graph-engineering
```

Restart or open a new Codex task after installing or upgrading the plugin so the
new skills and server configuration are discovered.

## Claude Code

After `npm run install:local`, register both MCP servers. Replace
`/absolute/path/to/home` with your home directory:

```bash
claude mcp add --scope user prompt-refiner -- node /absolute/path/to/home/plugins/prompt-refiner/runtime/mcp-server.js
claude mcp add --scope user graph-engineer -- node /absolute/path/to/home/plugins/prompt-refiner/graph-runtime/mcp-server.js
```

To keep deterministic refinement as the default, set
`PROMPT_REFINER_PROVIDER=none` in the server environment. Enable a semantic
provider only after reviewing [Interfaces](interfaces.md) and the example
configuration.

The Claude plugin manifest and shared skill sources live under
`plugins/prompt-refiner/`.

## Verify the installation

```bash
prompt-refiner refine "Review this repository and verify every finding"
graph-engineer plan --force-graph "Review every package and cross-check findings"
codex plugin list
claude mcp list
```

For a safe first execution:

```bash
graph-engineer run --autonomy read_only --executor codex --verifier claude \
  "Read package.json and report the package name with evidence"
```

Do not begin with write, external, or destructive autonomy. Review the generated
graph, budgets, and human gates first.

## Updating

```bash
git pull --ff-only
npm ci
npm run check
npm run install:local
codex plugin marketplace upgrade autonomous-graph-engineering
```

Re-register an MCP server only if its installed path or name changes.

## Uninstalling

```bash
codex plugin remove prompt-refiner@autonomous-graph-engineering
claude mcp remove prompt-refiner
claude mcp remove graph-engineer
npm uninstall -g @autonomous-graph-engineering/prompt-refiner
npm uninstall -g @autonomous-graph-engineering/graph-engineer
```

The generated `~/plugins/prompt-refiner` directory contains only installed
artifacts, but remove it manually only after confirming the resolved path.
