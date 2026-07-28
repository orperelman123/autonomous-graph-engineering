# @autonomous-graph-engineering/graph-engineer

Permission-safe graph planning, validation, execution, checkpoints, reconciliation, and grading.

## Failure boundaries

An explicit `human_gate` checkpoints the run and waits for its exact
fingerprint-bound approval token. A non-side-effecting node failure is
branch-scoped: the runtime marks that node failed, skips only its transitive
dependents, and finishes independent DAG branches before returning the
compatible terminal status `failed`. Token exhaustion, the graph deadline, and
any ambiguous side-effecting failure remain graph-scoped and stop the run.
Exhausted repair acceptance is a separate run-level terminal failure and does
not add a node `failureScope`. Portable reports expose node failure scope as
`"branch" | "graph"`.

Hermes Agent uses this same Graph Engineer MCP runtime, so these scheduling
semantics are identical there. Hermes skill-write approval is a separate host
control and is never manufactured as a fallback for a failed graph node.

```ts
import {
  planGraph,
  runGraph,
  validateGraph,
} from "@autonomous-graph-engineering/graph-engineer";

const graph = planGraph({
  prompt: "Audit every service and verify the findings.",
  autonomy: "read_only",
  forceGraph: true,
});

if (!validateGraph(graph).valid) throw new Error("invalid graph");
```

See the [repository documentation](https://github.com/orperelman123/autonomous-graph-engineering).

Diagnose a repository checkout or installed package without invoking a model:

```bash
graph-engineer doctor
graph-engineer doctor --json
```
