# Graph protocol

Autonomy levels:

- `plan_only`: validate and return the plan without running nodes.
- `read_only`: inspection and analysis.
- `workspace`: local edits; parallel writes need `worktree` isolation.
- `consequential`: external or destructive effects, always behind `human_gate`.

Node kinds are `deterministic`, `agent`, `parallel_map`, `reduce`, `router`, `verifier`, and `human_gate`.

The graph must be acyclic. Correction uses `repairPolicy`, which names one candidate, one verifier, an `acceptedField`, and a maximum repair count from the graph budgets.

Use `plan_graph` for generated plans and `validate_graph` after any
modification. Use synchronous `run_graph` only for short executions. Use
`start_graph` plus `get_graph_run` for multi-agent or potentially long
executions so the MCP client retains a polling handle. In both cases, the
requested autonomy must match the user's authority. A gate approval must name
the exact gate ID returned by the blocked run.
