# GitHub release-gate readiness audit

Date: 2026-07-25

## Scope

This read-only audit evaluated the public GitHub release configuration for
`orperelman123/autonomous-graph-engineering` against the repository's documented
`0.4.0` release gates. It made authenticated GET requests only. It did not push
a branch, change protection, create a pull request or tag, dispatch a workflow,
publish a package, deploy, or promote the project.

The candidate was:

- commit `68bc66d8999e8935ab9d76a6a52647aeda0f5944`;
- branch `codex/graphvigil-launch-readiness`;
- version `0.4.0`;
- remote base `c9b42f46bc89fe21b3e0ac6d19cd5603836a85e3`.

## Evidence

GitHub reported:

- public, active repository with `main` as the default branch;
- strict required status checks, linear history, review-conversation
  resolution, disabled force pushes, and disabled branch deletion;
- required `package`, four Windows/Linux Node-version test jobs, and CodeQL
  `analyze`;
- active `CI`, `CodeQL`, `Publish npm`, `Release`, and Dependabot workflows;
- a protected `npm` environment with a required reviewer;
- successful CI and CodeQL for the then-current remote `main` commit.

The candidate branch and `v0.4.0` tag were absent, so candidate-specific CI,
review, merge, post-merge, and tag evidence did not yet exist.

## Drift found

The release process requires the complete CI matrix, including the
`launch-readiness` job. Branch protection did not require
`launch-readiness`. A green pull request could therefore satisfy configured
required checks without proving the documented launch-readiness gate.

The auditor reports this state as `configuration_blocked`, with
`launch-readiness` in the deterministic missing-context list. It does not
change the rule. Adding a required context is a separate external
configuration action.

## Correction

The repository now includes:

- a pure deterministic evaluator;
- an explicit GET-only live collector;
- a strict path-free public report schema;
- pre-push, post-push, post-merge, drift, malformed-input, determinism, and
  permission-boundary regression coverage;
- this operator guide and dated evidence record.

The auditor is intentionally not added as a self-modifying GitHub workflow. It
reports configuration drift for an operator to review and correct through the
repository's normal administrative process.

## Residual gates

Before `0.4.0` can be tagged or published:

1. require `launch-readiness` in default-branch protection;
2. push the exact candidate branch and open a reviewed pull request;
3. require all exact candidate checks to pass;
4. merge and verify the resulting default-branch commit and post-merge checks;
5. create the tag only from that verified commit;
6. complete the documented npm bootstrap and registry read-back.

No result from this auditor authorizes those actions.
