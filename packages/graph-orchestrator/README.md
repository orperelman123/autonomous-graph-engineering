# @autonomous-graph-engineering/graph-engineer

Permission-safe graph planning, validation, execution, checkpoints, reconciliation, and grading.

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
