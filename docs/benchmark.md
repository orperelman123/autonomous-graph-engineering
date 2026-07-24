# Deterministic control-plane benchmark

Run:

```bash
npm run benchmark
```

The benchmark requires no provider credentials and makes no network requests. It runs three orchestration structures against the same versioned task, budgets, deterministic executor, and verifier fixture: the verifier rejects the first candidate and accepts the next candidate. The test executes twice and requires byte-identical reports.

| Structure | Expected result | What it demonstrates |
| --- | --- | --- |
| Direct route without repair | Failed | A rejected candidate fails closed |
| Direct execution with a bounded loop | Completed after one repair | Verifier-controlled local convergence |
| Validated graph with a bounded loop | Completed after one repair | DAG execution, bounded concurrency, checkpointing, audit, and local convergence |

All three structures use the same runtime so the fixture isolates orchestration topology. “Direct route” therefore means the runtime's two-node candidate-and-verifier route with repair disabled; it is not a raw provider invocation.

The command exits nonzero if runtime behavior differs from the versioned fixture expectations. Its strict-schema JSON report includes the fixture digest, seed, complete budgets, node count, executor and verifier calls, verifier output, repair rounds, checkpoint presence, audit presence, and usage.

## What this benchmark does not claim

This is a deterministic control-plane regression benchmark. It does not measure:

- model intelligence or factual answer quality;
- provider token usage or monetary cost;
- wall-clock performance;
- superiority on every task;
- OpenAI, Anthropic, or any other private production architecture.

A future provider-backed benchmark should use a preregistered task corpus, repeated trials, fixed models, blinded grading, safety cases, token and cost accounting, and published raw results. Until that exists, this repository should not advertise model-quality or cost improvements.
