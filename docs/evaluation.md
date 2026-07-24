# Evaluation

## Current deterministic coverage

- Prompt Refiner: 21 unit/interface tests and 27 evaluation cases
- Graph Engineer: 61 unit/interface tests and 20 adversarial evaluation cases
- Repository integration, launch-readiness, plugin, and schema contracts: 18 tests
- Total automated tests: 100
- Repository semantic corpus: 2 cases
- Strict TypeScript compilation
- Package dry-run checks, link validation, and secret scanning in CI

Run everything:

```bash
npm run check
npm run secret-scan
npm run link-check
npm run benchmark
```

## Covered behaviors

The suites exercise:

- exact prompt preservation and permission non-escalation;
- secret redaction, JSON-string prompt boundaries, and consequential-action classification;
- direct versus graph routing;
- malformed contracts, cycles, and missing dependencies;
- autonomy, gate, concurrency, depth, fan-out, token, timeout, output, and repair budgets;
- global concurrency across DAG nodes and map workers;
- output-schema enforcement;
- process-tree termination;
- repair-state and audit consistency;
- graph-bound approvals;
- atomic checkpoint resume, gate re-approval, and tamper rejection;
- actual Codex and Claude usage parsing;
- artifact grading and semantic expectations;
- reconciliation token rejection, retry, schema-validated completion, and no replay;
- side-effecting repair rejection and late-timeout reconciliation;
- standalone wrapper option boundaries;
- real prompt and graph objects against the published JSON Schemas;
- HTTP authentication and unsafe-bind refusal.

## What a passing score means

A passing artifact grade proves that the graph is valid, its checkpoint fingerprint matches, audit events are ordered, terminal lifecycle and node states agree, the verifier accepted the result, and actual usage stayed within budget.

A semantic grade additionally checks repository-specific required and forbidden claims. It does not independently prove every factual claim or establish that two models are non-collusive.

## Extending the corpus

Add read-only cases to [`config/graph-engineer-semantic-corpus.json`](../config/graph-engineer-semantic-corpus.json). Each case declares:

- the exact prompt;
- whether graph routing is required;
- strings that must all appear in the accepted candidate;
- optional failure phrases that must not appear.

Run the task once, preserve its checkpoint privately, and grade it with:

```bash
graph-engineer semantic-grade <run-id> \
  config/graph-engineer-semantic-corpus.json <case-id>
```

Do not commit provider transcripts or checkpoints unless they are deliberately redacted fixtures.
