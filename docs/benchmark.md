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

## Offline provider-envelope compatibility

Run:

```bash
npm run benchmark:providers:offline
```

This second reproducible benchmark feeds pinned synthetic Codex JSONL and Claude
JSON envelopes through the production parsers. Its strict-schema report records
the fixture digest and normalized outputs and usage. It uses no credentials and
makes no network requests.

This is a provider-adapter contract test, not a live provider benchmark. A live
outcome study still requires explicit approval because it can consume paid
provider capacity; it should preregister tasks, models, repetitions, blinded
graders, safety cases, and reporting before execution.

## Preregistered live provider harness

The repository includes an execution harness for OpenAI Responses and
Anthropic Messages. It is dry-run-first and is never invoked by CI. Start by
copying [`benchmark/live-plan.example.json`](../benchmark/live-plan.example.json)
to a new plan. Replace every placeholder with frozen public tasks, exact model
IDs, and current prices that you independently verify from the provider. The
example intentionally contains zero prices and placeholder model IDs, so it
fails validation until completed.

Validate the plan and calculate its declared maximum cost without reading API
keys or making network requests:

```bash
npm run benchmark:providers:live -- \
  --plan benchmark/my-live-plan.json \
  --output benchmark/results/my-dry-run.json
```

Output paths are create-only. Choose a new filename for every run; the harness
will not overwrite prior evidence. The plan hash uses canonical key ordering,
so formatting and object-key order do not change its identity. Local
`benchmark/results/` is gitignored because reports can contain full provider
responses. Publish a deliberately reviewed and redacted copy elsewhere only
when the study protocol requires it.

Live execution is intentionally a separate, explicit action:

```bash
OPENAI_API_KEY=... ANTHROPIC_API_KEY=... \
npm run benchmark:providers:live -- \
  --plan benchmark/my-live-plan.json \
  --execute \
  --confirm-budget-usd 1 \
  --output benchmark/results/my-live-run.json
```

The confirmation must numerically equal `budgetUsd`. Requests run sequentially
with a per-request timeout and a 2 MiB response limit. Provider keys are read
only in live mode and are never included in reports. OpenAI requests set
`store: false`. A provider error fails closed and marks cost accounting
incomplete because a failed request can still incur provider-side charges.

The declared maximum is a preregistered planning bound, not a provider billing
hard stop. The harness verifies reported tokens and accounted cost after each
response, but a provider may bill differently or change its reporting. Review
the raw create-only report before publishing claims. Required-phrase scoring is
transparent and deterministic, not blinded semantic grading.

API behavior should be checked against the official
[OpenAI Responses documentation](https://platform.openai.com/docs/api-reference/responses)
and [Anthropic Messages documentation](https://platform.claude.com/docs/en/api/messages).
Use each provider's current official pricing page when preparing a plan; the
repository deliberately does not hardcode rates.
