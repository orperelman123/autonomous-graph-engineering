# Examples

## Thirty-second offline demo

```bash
npm run demo
```

This compiles a real prompt and generates and validates a bounded read-only graph without provider credentials or network access.

## Copy-paste starter graph

[`repository-audit.graph.json`](repository-audit.graph.json) is a validated, read-only graph with two-agent concurrency and an independent Claude verifier.

```bash
graph-engineer validate examples/repository-audit.graph.json
graph-engineer run-file examples/repository-audit.graph.json
```

The first command is offline. The second invokes the configured Codex and Claude CLIs.

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
