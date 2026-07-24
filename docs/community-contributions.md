# Community contribution paths

Small, evidence-backed contributions are especially valuable while the project is young. Choose one bounded path below and use its matching issue form before opening a larger pull request.

## Diagnostic improvement

Improve one error, doctor check, or installation remediation.

Acceptance criteria:

- include a redacted reproduction;
- distinguish required failure from optional warning;
- add a deterministic regression test;
- update installation documentation when behavior changes.

## Evaluation case

Add a minimal deterministic case to the prompt or graph evaluation corpus.

Acceptance criteria:

- state the invariant and expected result;
- use synthetic input without private prompts or provider credentials;
- make no live provider call in CI;
- demonstrate that the case fails for the intended regression.

[`benchmark/fixtures/control-plane.v1.json`](../benchmark/fixtures/control-plane.v1.json) is an example of a versioned deterministic fixture with explicit expected results.

## Redacted starter graph

Contribute a reusable graph for a real workflow.

Acceptance criteria:

- validate against the public JSON Schema and runtime validator;
- default to `read_only` unless the example specifically teaches gates;
- declare budgets and concurrency explicitly;
- remove names, absolute user paths, credentials, transcripts, and operational targets;
- document which commands are offline and which invoke providers.

## Platform compatibility

Test one documented workflow on a specific platform.

Include:

- operating system, architecture, shell, Node version, and npm version;
- exact command and sanitized outcome;
- the smallest documentation or test correction supported by the evidence.

One successful machine does not establish universal platform support.

## Safety regression

Challenge one documented invariant with the smallest synthetic failing case.

- Do not publicly disclose an exploitable or suspected vulnerability.
- Use [private vulnerability reporting](https://github.com/orperelman123/autonomous-graph-engineering/security/advisories/new) first when impact is uncertain.
- Public safety regressions must contain no credentials, private repositories, production targets, or weaponized instructions.
- Maintainer review is required for changes to permissions, gates, repair, reconciliation, persistence, or execution isolation.

## Pull-request expectations

Every contribution should identify:

- user impact;
- safety and compatibility impact;
- tests executed and their results;
- documentation changed;
- remaining uncertainty.

Maintainers may narrow or split a proposal to preserve deterministic contracts and reviewability. Submission does not guarantee assignment, a response time, or merge.
