# GitHub release-gate auditor

The GitHub release-gate auditor compares a candidate with the repository's
required release controls without changing GitHub. It detects configuration
drift before a push and validates the exact branch, check-run, default-branch,
and tag evidence after a push or merge.

## Permission boundary

Live collection is opt-in through `--live`. The collector invokes `gh api`
with `--method GET` only. It has no mutation interface and never creates or
updates branches, protection rules, environments, pull requests, tags,
releases, workflow runs, or packages.

Snapshot mode performs no network requests:

```bash
npm run release-gate -- \
  --snapshot evidence/github-release-snapshot.json \
  --repo owner/repository \
  --candidate-branch codex/release-v0.4.0 \
  --candidate-commit 0123456789abcdef0123456789abcdef01234567 \
  --version 0.4.0 \
  --pretty
```

Live mode requires an authenticated `gh` session with read access:

```bash
npm run release-gate -- \
  --live \
  --repo owner/repository \
  --candidate-branch codex/release-v0.4.0 \
  --candidate-commit 0123456789abcdef0123456789abcdef01234567 \
  --version 0.4.0 \
  --pretty
```

The command exits nonzero for configuration drift, reference drift, or failed
checks. A pending branch or in-progress check is reported explicitly rather
than misclassified as a policy failure.

## Required controls

The deterministic evaluator requires these active workflows:

- `CI`
- `CodeQL`
- `Publish npm`
- `Release`

Default-branch protection must be strict, require linear history and review
conversation resolution, disable force pushes, and require:

- `package`
- `launch-readiness`
- `analyze`
- Node 20 and 22 tests on Windows and Ubuntu

The `npm` environment must exist, accept protected branches only, and include
at least one required reviewer.

## Candidate phases

| Phase | Meaning |
| --- | --- |
| `configuration_blocked` | A workflow, branch rule, or npm environment control is missing |
| `reference_blocked` | The candidate branch or release tag points to the wrong commit |
| `ready_to_push` | Controls pass and the exact candidate branch is not remote yet |
| `awaiting_checks` | The branch exists but required checks are missing or running |
| `checks_failed` | At least one exact candidate check completed unsuccessfully |
| `review_ready` | The candidate branch and all checks pass; merge review remains |
| `tag_ready` | The default branch is the exact verified candidate and the tag is available |
| `tagged` | The stable tag points to the exact verified candidate |

The report's `decision` fields separate permission to proceed to the next
operator-controlled stage from the overall phase.

## Snapshot contract

A snapshot contains normalized repository evidence:

- repository identity, default branch, and archived state;
- strict branch-protection booleans and required check contexts;
- workflow names and active/disabled state;
- protected npm-environment state and reviewer count;
- candidate branch, default branch, and release-tag commit references;
- unique check-run names, head SHAs, status, and conclusion.

The evaluator rejects malformed SHAs, repository identities, branches,
duplicate workflow names, and duplicate check names. It sorts set-like inputs
before evaluation, so the same snapshot produces byte-identical output.

Reports satisfy
[`github-release-gate-report.schema.json`](../schemas/github-release-gate-report.schema.json).
The public contract contains no timestamps, URLs, filesystem paths, API
responses, tokens, or account diagnostics. It declares `read_only` GitHub
access, `GET` as the sole method, and an empty mutation endpoint list.

## Interpretation

This report proves only the GitHub release gates represented by its exact
candidate commit and collected evidence. It does not approve a push, merge,
tag, workflow dispatch, npm publication, marketplace submission, deployment,
or promotion. Those remain separate operator actions under the
[release process](releasing.md).
