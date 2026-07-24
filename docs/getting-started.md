# Getting started with GraphVigil

Choose the shortest path that matches what you want to do. You do not need
provider credentials to evaluate the project, refine prompts, plan graphs, run
tests, or use the offline benchmarks.

## 1. Evaluate it locally

Requirements: Node.js 20 or 22, npm, and Git.

```bash
git clone https://github.com/orperelman123/autonomous-graph-engineering.git
cd autonomous-graph-engineering
npm ci
npm run quickstart
```

`quickstart` builds the workspaces and measures four offline journey steps:
environment readiness, intent-preserving prompt refinement, generation of one
bounded read-only graph, and schema plus runtime validation of all committed
workflow examples. It makes no provider call, requires no key, and returns
nonzero if any step fails.

For automation, emit the strict
[`quickstart-report.schema.json`](../schemas/quickstart-report.schema.json)
contract:

```bash
npm run quickstart -- --json
```

The JSON report contains only structural counts and policy outcomes. It omits
prompts, provider output, credentials, and local filesystem paths.

## 2. Improve one prompt

```bash
npx prompt-refiner refine \
  "Review authentication, preserve scope, and verify every finding"
```

The result keeps the exact original request and adds explicit requirements,
constraints, acceptance criteria, verification, and permissions.

## 3. Decide: direct, loop, or graph

Start with the smallest mechanism:

| Work shape | Use |
| --- | --- |
| One focused task with a clear finish line | Direct execution |
| One candidate that may need bounded verifier feedback | Direct execution plus repair loop |
| Distinct specialties, fan-out/fan-in, dependencies, or separate verification | Validated graph |
| External or destructive effect | Add a fingerprint-bound human gate |

Let the planner show its routing decision:

```bash
npx graph-engineer plan "Explain the package name"
npx graph-engineer plan --force-graph \
  "Audit every package in parallel and independently verify the findings"
```

The AI Builder Club's
[Graph Engineering Guide](https://www.aibuilderclub.com/blog/graph-engineering-guide-2026)
offers the same useful default: keep one well-scoped loop unless the work
genuinely requires specialties, parallelism, explicit hand-offs, failure
isolation, or an independent reviewer. GraphVigil makes those choices
machine-checkable with permissions, budgets, schemas, and gates.

## 4. Run a read-only graph

Real agent execution requires an authenticated Codex or Claude Code CLI:

```bash
npx graph-engineer run \
  --autonomy read_only \
  --executor codex \
  --verifier claude \
  "Read package.json and report the package name with exact evidence"
```

Start with `read_only`. Use `workspace` only when local edits are intended.
Consequential graphs stop at a human gate; MCP cannot approve that gate.

## 5. Install the host plugin

Install the local GraphVigil bundle for Codex and Claude Code:

```bash
npm run install:local
npm run verify:install
```

Reload the host after installation, then call `get_runtime_info` on both MCP
servers. Continue only when each reports `status: "current"`. This distinguishes
a correctly installed bundle from a host process that still has the previous
runtime loaded.

Build the native source bundle for another supported host:

```bash
npm run install:cursor
npm run install:copilot
```

Cursor and Copilot CLI must already be installed to run their host-specific
verification. See the [installation guide](installation.md) for registration
and host behavior.

## 6. Add native Atbash authorization

Atbash is optional and fail-closed. The public repository contains only the
GraphVigil adapter; the proprietary implementation remains in the official,
exactly pinned `@atbash/sdk` dependency.

Install and verify the SDK without activating it:

```bash
npm run install:local -- --with-atbash
npm run verify:install -- --expect-atbash
```

Activate only after the Atbash organization and process environment are
configured:

```bash
npm run install:local -- --with-atbash --enable-atbash
```

Never write Atbash credentials into a manifest or repository file. See the
[external security provider guide](external-security-provider.md).

## 7. Inspect evidence and recover safely

Every non-plan graph run writes an append-only JSONL audit and an atomic
checkpoint under `.graph-runs/` by default:

```bash
npx graph-engineer inspect <run-id>
npx graph-engineer grade <run-id>
```

Interrupted read-only nodes may retry. Ambiguous write or external nodes require
operator reconciliation; they are never replayed automatically.

### Windows executor troubleshooting

GraphVigil resolves npm-installed Codex and Claude shims to their native
JavaScript or executable entrypoints before spawning them. If automatic
discovery is unavailable, set `CODEX_EXECUTABLE` or `CLAUDE_EXECUTABLE` to a
native `.exe` or JavaScript entrypoint. Do not point either variable at a
`.cmd`, `.bat`, PowerShell, or extensionless shell shim; those are rejected
instead of being executed through a shell.

## Next steps

- Workflow examples: [repository audit, implementation, migration, and release preparation](../examples/README.md)
- Developers: [developer guide](development.md)
- Architecture: [architecture](architecture.md)
- CLI, MCP, HTTP, and schemas: [interfaces](interfaces.md)
- Security: [security model](security-model.md)
- Reproducible evaluation: [evaluation](evaluation.md)
- Graphs versus loops: [why graphs, loops, and gates belong together](why-graphs.md)
