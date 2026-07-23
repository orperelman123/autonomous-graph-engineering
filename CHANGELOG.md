# Changelog

All notable changes are documented here.

## Unreleased

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
