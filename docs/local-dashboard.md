# Local dashboard

The GraphVigil local dashboard is an optional, read-only view of bounded
portable run-report summaries. It renders runs, checkpoint state, graph
budgets, verifier outcomes, token usage, recorded cost, and integrity signals
without exposing prompts, outputs, verifier reasons, audit data, filesystem
paths, or credentials.

Build the graph runtime and start the dashboard:

```sh
npm run build --workspace @autonomous-graph-engineering/graph-engineer
graph-engineer dashboard 4319
```

When running from a source checkout:

```sh
node packages/graph-orchestrator/dist/cli.js dashboard 4319
```

The command reads `.graph-runs` by default. Set
`GRAPH_ENGINEER_AUDIT_DIRECTORY` to select another existing audit directory.
The dashboard never creates that directory.

Open `http://127.0.0.1:4319`. The server refuses non-loopback bindings and
offers only these fixed `GET` routes:

| Route | Result |
| --- | --- |
| `/` | Fixed dashboard document |
| `/app.js` | Fixed renderer using DOM `textContent` |
| `/style.css` | Fixed stylesheet |
| `/healthz` | Read-only health result |
| `/v1/dashboard` | Strict redacted snapshot JSON |

Every other path returns `404`; every non-`GET` method returns `405`. There is
no arbitrary file route, mutation control, approval input, provider call, or
credential flow.

## Safety and limits

The dashboard:

- reads at most 100 lexically ordered checkpoint candidates and reports when
  the list is truncated;
- accepts only normalized run ids containing letters, numbers, `.`, `_`, or
  `-`, and hashes unsafe artifact labels before displaying them;
- rejects symlinked, missing, changing, or non-regular artifacts;
- caps checkpoints at 2 MB, audit logs at 5 MB, and responses at 1 MB;
- renders directly from the bytes that passed containment and size checks;
- marks a `running` checkpoint stale after 15 minutes without changing it;
- reports graph-fingerprint and audit-sequence integrity without displaying
  graph ids, node ids, event data, errors, prompts, outputs, or reasons;
- emits a snapshot conforming to
  [`local-dashboard-snapshot.schema.json`](../schemas/local-dashboard-snapshot.schema.json);
- uses `Cache-Control: no-store`, a deny-by-default Content Security Policy,
  MIME sniffing protection, and no referrer.

The dashboard is an inspection surface, not an authorization surface. It
cannot approve a human gate, resume or reconcile a run, alter a checkpoint, or
change an Atbash decision.

## Host compatibility

Codex, Claude Code, Cursor, GitHub Copilot CLI, and Hermes Agent use the same
local command and snapshot contract. The `contract-only` host list means the
repository integration contract is present; it does not claim a live host
version was tested.

Hermes users can run the command from the same project terminal after following
the [Hermes installation instructions](installation.md#hermes-agent). The
dashboard does not add MCP tools or write to Hermes configuration.

Atbash remains the optional official external authorization provider for graph
execution. The dashboard consumes only structural report evidence and neither
calls, replaces, disables, nor exposes Atbash or its proprietary source. A
fail-closed Atbash decision remains authoritative.

## Public contract and migration

The JSON endpoint is version `1.0`. Consumers must reject unknown fields using
the public schema. Run ordering is deterministic by run id. Invalid artifacts
use bounded error codes instead of raw exception messages or local paths.

Existing graph, checkpoint, audit, and portable-report formats do not change.
The dashboard reuses the portable report producer and adds a separate summary
contract, so existing CLI and API consumers require no migration.
