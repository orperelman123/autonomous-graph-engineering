# Executor and grader extensions

GraphVigil exposes a versioned in-process extension boundary for repository-local
executors and artifact graders. Extensions are trusted code: registering one
does not sandbox its implementation. The runtime still owns graph validation,
permissions, budgets, gates, output-schema enforcement, checkpoints, audit
ordering, repair limits, and reconciliation.

## Register an executor

```ts
import {
  GraphExtensionRegistry,
  planGraph,
  runGraph,
  securityProviderFromEnvironment,
  type GraphExecutor,
} from "@autonomous-graph-engineering/graph-engineer";

const executor: GraphExecutor = {
  name: "acme-reviewer",
  async execute(request) {
    return { output: { reviewed: request.nodeId } };
  },
};

const registry = new GraphExtensionRegistry({
  securityProvider: securityProviderFromEnvironment(),
})
  .registerExecutor({
    executor,
    permissions: ["none", "read"],
  })
  .seal();

const graph = planGraph({
  prompt: "Read the declared files and report evidence.",
  primaryExecutor: executor.name,
  verifierExecutor: executor.name,
});
const result = await runGraph(graph, { executors: registry.executors() });
```

Extension names use lowercase letters, digits, and hyphens, start with a
letter, and contain at most 64 characters. Built-in names (`codex`, `claude`,
and `local`) and prototype-sensitive names are reserved. Registration is
duplicate-safe, and sealing prevents late mutation.

Each executor declares an explicit permission allowlist. Dispatch fails before
the delegate runs when a node requests any other permission. Results must
contain only `output` and optional finite, non-negative `usage`. A node's
declared output schema remains authoritative after the executor returns.

Pass `securityProviderFromEnvironment()` when extensions must share the
configured authorization boundary. The provider receives only bounded metadata
and hashes, exactly as it does for built-in executors. The official Atbash SDK
remains an optional external dependency; GraphVigil neither vendors nor
reimplements it.

## Register a grader

```ts
const registry = new GraphExtensionRegistry()
  .registerGrader({
    name: "acme-policy",
    async grade(context) {
      return {
        criteria: [{
          id: "policy-evidence",
          passed: context.checkpoint.status === "completed",
          detail: "run reached a completed checkpoint",
        }],
      };
    },
  })
  .seal();

const grade = await gradeCheckpoint(auditDirectory, runId, {
  graders: registry.graders(),
});
```

Graders run serially for deterministic ordering against a cloned, frozen
checkpoint and audit-event view. Their output is fail-closed and bounded by
grader count, criteria count, detail length, duplicate IDs, and timeout.
Extension criteria are namespaced as
`extension:<grader-name>:<criterion-id>`.

Because graders are trusted in-process JavaScript, they may still perform
arbitrary actions outside this API or ignore a timed-out promise. Review and
pin extension packages exactly like any other executable dependency. Do not
pass untrusted third-party code, secrets, raw private prompts, or proprietary
SDK source into an extension.

## Migration and compatibility

Existing built-in executor names and `gradeCheckpoint(directory, runId)` calls
remain compatible. Programs may opt in incrementally:

1. replace a hand-built executor record with a registry;
2. declare the smallest permission allowlist;
3. configure the existing security provider when required;
4. seal the registry before planning or execution;
5. add graders through the optional third argument to `gradeCheckpoint`.

Unknown but syntactically safe executor names can validate as portable graph
contracts. Execution still fails closed unless the caller supplies that exact
registered executor.
