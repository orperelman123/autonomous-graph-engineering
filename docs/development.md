# Developer guide

This guide is the canonical entry point for changing Autonomous Graph
Engineering. Read the [architecture](architecture.md) and
[security model](security-model.md) before changing permissions, gates,
persistence, executors, or provider boundaries.

GraphVigil is the public display name. Stable technical identifiers remain
`prompt-refiner`, `graph-engineer`, and the
`@autonomous-graph-engineering/*` npm scope to avoid breaking installations.

## Prerequisites and setup

- Node.js 20 or 22
- npm
- Git

```bash
git clone https://github.com/orperelman123/autonomous-graph-engineering.git
cd autonomous-graph-engineering
npm ci
npm run check
```

The default build, tests, evaluations, demo, doctor, and offline benchmarks are
credential-free. Never add a real API key to a repository file.

## Source map

| Area | Primary files | Responsibility |
| --- | --- | --- |
| Prompt compilation | `packages/prompt-refiner/src/compiler.ts`, `security.ts`, `provider.ts` | Preserve intent, classify risk, constrain optional semantic refinement |
| Prompt interfaces | `packages/prompt-refiner/src/cli.ts`, `hook.ts`, `mcp-server.ts`, `server.ts` | CLI, host hooks, MCP, and HTTP adapters |
| Graph planning | `packages/graph-orchestrator/src/planner.ts`, `validator.ts`, `types.ts` | Route work, compile DAGs, reject invalid topology or permissions |
| Runtime | `packages/graph-orchestrator/src/runtime.ts`, `persistence.ts`, `reconciliation.ts` | Schedule nodes, enforce budgets, checkpoint, resume, and reconcile |
| Executor boundary | `packages/graph-orchestrator/src/executors.ts`, `security.ts`, `output-schema.ts` | Launch bounded agents, authorize delegation, normalize output and usage |
| Verification | `packages/graph-orchestrator/src/grader.ts`, `semantic-grader.ts`, `evaluation.ts` | Acceptance, repository evidence, semantic cases, and adversarial evals |
| Public contracts | `schemas/`, `docs/interfaces.md` | Stable machine-readable inputs and reports |
| Host packages | `plugins/prompt-refiner/` | Codex, Claude Code, Cursor, and GitHub Copilot integration sources |
| Repository tools | `scripts/` | Install, verify, doctor, benchmark, scan, and release checks |

Generated `dist/` directories are build output. Edit TypeScript sources and
rebuild; do not make source changes only in generated files.

## Development commands

| Command | Purpose | Network or credentials |
| --- | --- | --- |
| `npm run build` | Compile both workspaces | None |
| `npm run typecheck` | Compile and type-check without emitting graph output | None |
| `npm test` | Run all workspace and repository contract tests | None |
| `npm run eval` | Run 21 graph and 30 prompt adversarial evaluations | None |
| `npm run check` | Type-check, test, evaluate, and build | None |
| `npm run doctor -- --json` | Inspect deterministic installation readiness | None |
| `npm run demo` | Generate and validate a credential-free example | None |
| `npm run benchmark` | Run the deterministic control-plane benchmark | None |
| `npm run benchmark:providers:offline` | Test pinned provider envelope parsing | None |
| `npm run secret-scan` | Reject likely secrets and private paths | None |
| `npm run link-check` | Validate local Markdown links | None |

Run a focused test while iterating:

```bash
npx tsx --test test/live-provider-benchmark.test.ts
npx tsx --test packages/graph-orchestrator/test/runtime.test.ts
```

Before a pull request, run the complete gate:

```bash
npm ci
npm run check
npm run secret-scan
npm run link-check
npm audit --omit=dev --audit-level=high
```

## How to change the control plane

### Prompt refinement

1. Add or update a case in `packages/prompt-refiner/src/evaluation.ts`.
2. Add a focused regression test.
3. Preserve the original prompt and every explicit negative constraint.
4. Keep deterministic classification authoritative over semantic suggestions.
5. Update `schemas/prompt-refinement.schema.json` and
   [interfaces](interfaces.md) if the public result changes.

### Graph planning or validation

1. Update the graph type and public schema together.
2. Add a planner/validator test for the accepted case.
3. Add an adversarial rejection test for the unsafe or malformed case.
4. Confirm permissions cannot increase across planning, gates, repair, resume,
   or reconciliation.
5. Re-run the full graph evaluation suite.

### Runtime, persistence, or reconciliation

Treat these as safety-critical:

- account usage before publishing accepted output;
- make checkpoint commits atomic;
- never replay an ambiguous side effect automatically;
- bind approvals and reconciliation evidence to the exact graph and attempt;
- terminate complete executor process trees on timeout;
- keep repair scope-preserving and capped.

Every fix needs a crash, timeout, resume, or budget regression test matching the
failure mode.

### Host plugin changes

Shared source lives under `plugins/prompt-refiner/`. Keep Codex, Claude Code,
Cursor, and Copilot manifests version-synchronized. Run:

```bash
npm run install:local
npm run verify:install
npx tsx --test test/platform-plugins.test.ts test/install-rollback.test.ts
```

Installation is transactional and must restore the previous bundle if
post-activation verification fails. Every managed install must also generate a
new installation identity, propagate it to both MCP configurations, and make a
stale process report `reload_required` without exposing local paths.

### Public contracts

JSON Schemas use draft 2020-12, reject unknown fields, and are tested with AJV
strict mode. When changing a report:

1. change the producer;
2. change its schema;
3. validate a real producer result in `test/schema-contracts.test.ts`;
4. document compatibility and migration impact.

Runtime validation remains authoritative; schemas are an interoperable first
line, not a replacement for runtime policy.

## Live provider benchmark development

The live harness is opt-in. Tests must inject a mocked `fetchImpl`; CI must
never contact OpenAI or Anthropic. Development rules:

- keep exact model IDs and prices in a user-created plan, never in source;
- require `--execute` plus an exact finite budget confirmation;
- read only the documented API-key environment variable;
- never serialize keys;
- keep requests sequential, timed, and response-size bounded;
- treat malformed usage or provider errors as failed, incomplete accounting;
- keep raw results under gitignored `benchmark/results/`.

See the complete [benchmark protocol](benchmark.md). A developer test is not
authorization to spend provider budget.

## Agent process portability

All agent subprocesses run with `shell: false`. On Windows, use
`resolveAgentCommand` from the prompt-refiner package so npm's extensionless,
`.cmd`, and PowerShell shims cannot be selected accidentally. Resolution must
prefer the package's JavaScript or native executable entrypoint, preserve
argument boundaries, and fail closed when only a shell shim is available.
Cover new CLI layouts with platform-independent fixture tests.

## Security and privacy review

Before committing, inspect both tracked and untracked changes:

```bash
git status --short
git diff --check
git diff
npm run secret-scan
```

Do not commit:

- `.env` files, API keys, tokens, cookies, or private keys;
- provider transcripts or live benchmark results without deliberate review;
- graph checkpoints or audit logs containing user work;
- usernames, home-directory paths, private repository data, or internal URLs;
- copied proprietary SDK source.

For security-sensitive changes, update the
[security model](security-model.md) or add a focused threat model. Report
vulnerabilities through [SECURITY.md](../SECURITY.md), not a public issue.

## Version and release preparation

The release version must match:

- root and workspace `package.json` files;
- exact workspace dependency versions;
- `package-lock.json`;
- MCP server metadata;
- Codex, Claude, Cursor, and Copilot plugin or marketplace manifests;
- launch-readiness assertions;
- the changelog.

Verify a candidate without publishing:

```bash
node scripts/verify-release-version.mjs vX.Y.Z
npm run check
npm run secret-scan
npm run link-check
npm audit --omit=dev --audit-level=high
npm pack --dry-run --workspace @autonomous-graph-engineering/prompt-refiner
npm pack --dry-run --workspace @autonomous-graph-engineering/graph-engineer
```

Tagging, npm publication, marketplace submission, paid benchmarks, and
promotion are separate consequential actions. Follow the evidence-gated
[release process](releasing.md); never infer credentials or bypass a provider
or marketplace gate.

## Pull-request definition of done

A change is ready only when:

- behavior and public-contract changes are documented;
- a regression test proves the intended behavior and relevant failure mode;
- deterministic tests make no live provider calls;
- the full local gate passes;
- secret and private-path scans pass;
- the diff contains no unrelated or generated artifacts;
- required GitHub CI, CodeQL, review, and conversation-resolution gates pass;
- the exact merged `main` commit passes post-merge CI.
