# Examples

## Thirty-second offline demo

```bash
npm run demo
```

This compiles a real prompt and generates and validates a bounded read-only graph without provider credentials or network access.

## Real-world workflow pack

Every graph in this pack satisfies the public graph schema and the runtime
validator. Validate a graph before adapting or running it:

```bash
graph-engineer validate examples/repository-audit.graph.json
```

Validation is offline. Execution invokes the configured Codex and Claude CLIs.
Review each prompt and permission against your repository before running it.

| Workflow | Graph | Autonomy | Intended effect |
| --- | --- | --- | --- |
| Repository audit | [`repository-audit.graph.json`](repository-audit.graph.json) | `read_only` | Investigate components concurrently and verify findings |
| Bounded implementation | [`implementation.graph.json`](implementation.graph.json) | `workspace` | Scope one change, edit serially, then verify the diff |
| Interface migration | [`migration.graph.json`](migration.graph.json) | `workspace` | Inventory consumers, migrate serially, then verify compatibility |
| Release preparation | [`release-preparation.graph.json`](release-preparation.graph.json) | `read_only` | Assemble and verify readiness evidence without releasing |

Run the selected graph only after reviewing its permissions:

```bash
graph-engineer run-file examples/repository-audit.graph.json
```

### Safety contract

- The two workspace examples contain exactly one serial `write` node. They do
  not commit, push, publish, delete data, or request credentials.
- The audit and release-preparation examples are read-only.
- All examples use explicit node, fan-out, concurrency, depth, repair, time,
  estimated-token, and actual-token budgets.
- Independent verification is read-only. Generic repair is disabled so a
  verifier cannot replay or replace workspace changes.
- Prompts are templates, not authorization. Consequential or destructive work
  requires a separately planned graph with an exact fingerprint-bound human
  gate.

## Deterministic refinement

```bash
prompt-refiner refine "Audit every route and verify each finding"
```

## Read-only cross-provider execution

```bash
graph-engineer run \
  --autonomy read_only \
  --executor codex \
  --verifier claude \
  "Read package.json and report the package name with exact evidence."
```

## Consequential planning

```bash
graph-engineer plan \
  --autonomy consequential \
  "Deploy the approved build to production."
```

The resulting graph contains a human gate. Never paste approval tokens into agent prompts.

## Resume and grade

```bash
graph-engineer inspect <run-id>
graph-engineer resume --approve <returned-approval-token> <run-id>
graph-engineer grade <run-id>
```

## Reconciliation

If a write process ends without a trustworthy acknowledgement, inspect the checkpoint. After independently verifying the target:

```bash
graph-engineer reconcile <run-id> <node-id> \
  --token <returned-reconciliation-token> \
  --outcome not_applied \
  --evidence "Verified target state did not change."
```

Use `completed` plus `--output-json` only when the intended outcome was independently verified.
