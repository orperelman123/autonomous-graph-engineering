# Interfaces

## Prompt Refiner CLI

```bash
prompt-refiner refine [--semantic] <prompt>
prompt-refiner eval
prompt-refiner serve [port]
codex-better [codex arguments...]
claude-better [claude arguments...]
```

Deterministic mode requires no provider key. Optional semantic mode uses the variables in [`config/prompt-refiner.example.env`](../config/prompt-refiner.example.env).

## Graph Engineer CLI

```bash
graph-engineer plan [--autonomy level] [--executor codex|claude|local] \
  [--verifier codex|claude|local] [--force-graph] <prompt>
graph-engineer validate <graph.json>
graph-engineer run [options] <prompt>
graph-engineer run-file [--approve <token>] <graph.json>
graph-engineer resume [--approve <token>] <run-id>
graph-engineer inspect <run-id>
graph-engineer reconcile <run-id> <node-id> --token <token> \
  --outcome completed|not_applied --evidence <text> [--output-json <json>]
graph-engineer grade <run-id>
graph-engineer semantic-grade <run-id> <corpus.json> <case-id>
graph-engineer eval
graph-engineer serve [port]
```

Autonomy levels are `plan_only`, `read_only`, `workspace`, and `consequential`.

## MCP

Prompt Refiner exposes prompt compilation and evaluation tools. Graph Engineer
exposes:

- `plan_graph`
- `validate_graph`
- `run_graph` for short synchronous executions
- `start_graph` for immediate background-job creation
- `get_graph_run` for polling a background job
- `evaluate_graph_runtime`

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

Runtime validation remains authoritative even when a client performs JSON Schema validation first.
