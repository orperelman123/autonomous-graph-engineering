# Interfaces

For repository setup, source ownership, tests, and contract-change workflow,
see the [developer guide](development.md).

## Prompt Refiner CLI

```bash
prompt-refiner refine [--semantic] <prompt>
prompt-refiner eval
prompt-refiner serve [port]
codex-better [--semantic] [--dry-run] [--] <prompt>
claude-better [--semantic] [--dry-run] [--] <prompt>
```

Deterministic mode requires no provider key. Optional semantic mode uses the variables in [`config/prompt-refiner.example.env`](../config/prompt-refiner.example.env).
The standalone wrappers accept prompt-refiner options only; they do not forward
arbitrary flags to the underlying agent. Use `--` when the prompt itself begins
with a double-dash token.

## Graph Engineer CLI

```bash
graph-engineer plan [--autonomy level] [--executor codex|claude|local] \
  [--verifier codex|claude|local] [--force-graph] <prompt>
graph-engineer doctor [--json] [--root <path>] [--plugin-dir <path>]
graph-engineer validate <graph.json>
graph-engineer run [options] <prompt>
graph-engineer run-file [--approve <token>] <graph.json>
graph-engineer resume [--approve <token>] <run-id>
graph-engineer inspect <run-id>
graph-engineer report <run-id>
graph-engineer reconcile <run-id> <node-id> --token <token> \
  --outcome completed|not_applied --evidence <text> [--output-json <json>] \
  [--termination-json <json>]
graph-engineer grade <run-id>
graph-engineer semantic-grade <run-id> <corpus.json> <case-id>
graph-engineer eval
graph-engineer serve [port]
```

Autonomy levels are `plan_only`, `read_only`, `workspace`, and `consequential`.

`graph-engineer report` exports a portable structural report from an existing
checkpoint and audit log. It includes the graph topology and budgets, node
states, usage, verifier acceptance, ordered lifecycle evidence, and SHA-256
artifact digests. Free-text goals, prompts, labels, outputs, verifier reasons,
errors, audit payloads, and local paths are omitted by design. The output
satisfies [`portable-run-report.schema.json`](../schemas/portable-run-report.schema.json).

Side-effecting executor requests carry a stable `idempotencyKey` for the logical
node and a unique `attemptId` for the concrete invocation. A timeout is an
ambiguous outcome, not proof that the subprocess made no change. Reconciling a
timed-out node as `not_applied` therefore requires structured termination
evidence whose attempt ID and executor match the checkpoint. This evidence is
operator-supplied and auditable; exactly-once behavior still depends on the
downstream executor honoring the idempotency key.

## MCP

Prompt Refiner exposes:

- `refine_prompt`
- `get_runtime_info`
- `evaluate_prompt_refiner`

Graph Engineer exposes:

- `get_runtime_info`
- `plan_graph`
- `validate_graph`
- `run_graph` for short synchronous executions
- `start_graph` for immediate background-job creation
- `get_graph_run` for polling a background job
- `evaluate_graph_runtime`

`get_runtime_info` reports the component version and managed installation
identity. Its `status` is `current` after the host loads the active
installation, `reload_required` when the bundle changed after that process
started, `unmanaged` for source development, or `invalid_manifest` when a
managed identity cannot be verified. Installation IDs are random correlation
values, not credentials, and the response never returns the manifest path.

Use `start_graph` and poll `get_graph_run` for multi-agent graphs or any run
whose budget can approach the MCP client's request timeout. Jobs are retained in
memory by the MCP server, with a default maximum of 16. Set
`GRAPH_ENGINEER_MCP_MAX_JOBS` to an integer from 1 through 128 to change the
bound. Completed jobs are evicted oldest-first when the bound is reached.

The MCP execution surface never accepts human-gate approvals or reconciliation.
Background jobs do not survive an MCP server restart, but their normal runtime
audit and checkpoint files remain available for CLI inspection and resume.

Start the servers:

```bash
node packages/prompt-refiner/dist/mcp-server.js
node packages/graph-orchestrator/dist/mcp-server.js
```

## HTTP

Prompt Refiner defaults to `127.0.0.1:4317`. Graph Engineer defaults to `127.0.0.1:4318`.

Graph endpoints:

- `GET /healthz`
- `POST /v1/graphs/plan`
- `POST /v1/graphs/validate`
- `POST /v1/graphs/run`

For non-loopback operation:

```bash
GRAPH_ENGINEER_HOST=0.0.0.0
GRAPH_ENGINEER_API_KEY=<random-secret>
graph-engineer serve
```

Send `Authorization: Bearer <random-secret>` to `/v1/` endpoints. Put the service behind TLS and network controls. HTTP approvals remain disabled unless `GRAPH_ENGINEER_ALLOW_HTTP_APPROVALS=1` is also set.

## Contracts

- [`prompt-refinement.schema.json`](../schemas/prompt-refinement.schema.json)
- [`autonomous-graph.schema.json`](../schemas/autonomous-graph.schema.json)
- [`doctor-report.schema.json`](../schemas/doctor-report.schema.json)
- [`portable-run-report.schema.json`](../schemas/portable-run-report.schema.json)
- [`benchmark-report.schema.json`](../schemas/benchmark-report.schema.json)
- [`provider-benchmark-report.schema.json`](../schemas/provider-benchmark-report.schema.json)
- [`live-provider-benchmark-plan.schema.json`](../schemas/live-provider-benchmark-plan.schema.json)
- [`live-provider-benchmark-report.schema.json`](../schemas/live-provider-benchmark-report.schema.json)

Runtime validation remains authoritative even when a client performs JSON Schema validation first.
