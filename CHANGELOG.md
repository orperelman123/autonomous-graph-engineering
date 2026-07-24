# Changelog

All notable changes are documented here.

## Unreleased

- Add a schema-validated `graph-engineer report` export with graph topology,
  budgets, verifier acceptance, usage, artifact digests, and structurally
  redacted lifecycle evidence.

## 0.3.3 - 2026-07-24

- Preserve clause-scoped negative constraints across comma-separated action
  lists so excluded external and destructive actions cannot create permissions
  or graph human gates.
- Add managed runtime identity to installed MCP servers so an upgraded but
  still-running host reports `reload_required` until it reloads the active
  installation.
- Launch and identity-check both staged MCP servers before completing an
  installation, preserving automatic rollback for broken runtime bundles.
- Synchronize the Codex plugin manifest with the release version so host plugin
  caches can detect upgrades instead of retaining the original build version.

## 0.3.2 - 2026-07-24

- Introduce the public GraphVigil display name while preserving every existing
  package, CLI, MCP, and plugin identifier for compatibility.
- Add a canonical developer guide, documentation index, tracked-artifact
  privacy test, and explicit proprietary-SDK boundary documentation.
- Add a credential-free `npm run quickstart` and a task-oriented onboarding
  guide for direct execution, bounded loops, graphs, host plugins, and Atbash.
- Add a dry-run-first OpenAI Responses and Anthropic Messages benchmark
  harness with preregistered plans, explicit cost ceilings, create-only
  artifacts, provider-specific token accounting, strict schemas, and mocked
  network coverage.
- Add a manual, OIDC-based npm trusted-publishing workflow with provenance,
  exact tag/version verification, ordered publication, integrity-checked
  retries, least-privilege permissions, and documented bootstrap gates.
- Resolve Codex and Claude npm shims to native package entrypoints on Windows,
  preventing graph and wrapper executors from failing with `spawn EPERM`.

## 0.3.1 - 2026-07-24

- Make checkpoint commits budget-atomic: retain provider usage while excluding
  outputs rejected by the graph token budget.
- Prevent over-budget checkpoint resumes from replaying provider work, and
  preserve cumulative per-node usage across retryable read-only resumes.
- Classify token exhaustion as a distinct `budget` failure and sanitize legacy
  over-budget checkpoints when they are resumed.
- Make the CLI honor `GRAPH_ENGINEER_AUDIT_DIRECTORY` for resumed checkpoint
  writes as well as reads.

## 0.3.0 - 2026-07-24

- Add native, fail-closed executor authorization through the official
  `@atbash/sdk` package as an exact optional dependency.
- Add a vendor-neutral external security-provider module contract.
- Send only bounded metadata and SHA-256 hashes across the authorization
  boundary, excluding raw prompts, inputs, paths, and idempotency keys.
- Deny executor invocation when provider import, configuration, network,
  timeout, response validation, hold, or block checks fail.
- Keep the proprietary SDK as a separate dependency rather than copying or
  bundling its implementation into this project.

## 0.2.0 - 2026-07-24

- Add a versioned GitHub Copilot marketplace manifest and an evidence-gated
  release, publication, marketplace, benchmark, promotion, and rollback guide.
- Replace a timing-sensitive asynchronous MCP polling assertion with a bounded
  deadline and wait for MCP test subprocesses to exit cleanly.
- Reject prototype-sensitive node identifiers at schema, validator, and
  reconciliation boundaries to prevent dynamic-key prototype pollution.
- Add native Cursor and GitHub Copilot CLI plugin manifests, shared skills, MCP
  configuration, a Cursor always-on rule, and a Copilot prompt-transformation
  hook with `!raw` bypass.
- Add transactional plugin-bundle activation with rollback, atomic install
  locking, and regression tests.
- Add stable side-effect idempotency keys, unique attempt identifiers, timeout
  classification, and attempt-bound termination evidence for reconciliation.
- Add four-host tri-state diagnostics that do not confuse CLI discovery with
  verified authentication or MCP registration.
- Add a reproducible offline Codex/Claude provider-envelope compatibility
  benchmark and strict public report schema.
- Validate operator-reconciled outputs against the node's declared output schema before changing checkpoint or audit state.
- Add a concise graph-versus-loop guide, public roadmap, proof-oriented README, and Claude Code marketplace quick start.
- Add a deterministic environment doctor, credential-free demo, validated starter graph, and reproducible control-plane benchmark.
- Add packaged `graph-engineer doctor`, strict doctor/benchmark report schemas, versioned benchmark fixtures, and bounded community contribution forms.

- Disable generic automated repair for write, external, and destructive
  candidates; timed-out side-effecting nodes remain reconciliation-required.
- Parse `--semantic`, `--dry-run`, and `--` correctly in the standalone Codex
  and Claude wrappers instead of treating wrapper flags as prompt text.
- Validate real compiler and planner outputs against the public JSON Schemas
  during the root test suite.
- Add `npm run verify:install` to start both installed MCP runtimes and verify
  their complete tool inventories.
- Add a native Claude marketplace that activates the shared hook and skills,
  remove the fixed Claude cache version, and document explicit Codex MCP
  registration instead of an inert source `.mcp.json`.
- Add bounded asynchronous MCP graph jobs with `start_graph` and
  `get_graph_run`, avoiding client request timeouts for long multi-agent runs.
- Preserve the originating JSON-RPC request ID when an MCP tool call fails.
- Redact the complete semantic-provider payload and reject provider attempts to
  remove required permissions or deterministic safety constraints.
- Block Claude/Codex hook processing when clarification or consequential
  confirmation is required; retain `!raw` as an explicit one-prompt bypass.
- Fail closed when the executable hook cannot parse or refine a prompt.
- Serialize untrusted prompt and semantic-brief values as JSON strings and
  expand conservative detection of destructive commands and external actions.
- Reject unsafe `maxParallel` budgets and require completed human gates to be
  explicitly re-approved when resuming an unfinished checkpoint.
- Declare the installed plugin runtime as ESM so Node starts its MCP servers
  and hook without module-type warnings.
- Pin the expected prompt-evaluation corpus size and prevent empty corpora from
  reporting a perfect score.

## 0.1.0 - 2026-07-23

- Open-source Prompt Refiner and Graph Engineer monorepo.
- Add deterministic intent and permission preservation.
- Add bounded DAG orchestration and verifier-controlled repair.
- Add Codex and Claude Code executor adapters.
- Add schema enforcement, global concurrency, fan-out, timeout, output, and token budgets.
- Add fingerprint-bound gates, atomic checkpoints, crash-safe resume, and CLI-only reconciliation.
- Add artifact and repository semantic graders.
- Add MCP, authenticated loopback-first HTTP, portable plugin sources, CI, CodeQL, and governance documentation.
