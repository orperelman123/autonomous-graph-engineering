# Governance

The project uses a maintainer-led, contribution-friendly model.

## Roles

- Contributors propose issues, documentation, tests, and code.
- Maintainers review changes, manage releases, respond to security reports, and protect project invariants.

## Decision making

Routine changes are accepted through reviewed pull requests. Decisions prioritize:

1. user intent and least privilege;
2. deterministic enforcement and testability;
3. backward-compatible public contracts;
4. operational clarity and evidence;
5. provider neutrality.

Security-sensitive or breaking changes require explicit maintainer approval and updated documentation, tests, and migration guidance.

The [community contribution paths](docs/community-contributions.md) define bounded entry points for diagnostics, evaluation cases, starter graphs, platform evidence, and public non-sensitive safety regressions.

## Releases

Maintainers create tagged releases after CI, security scanning, package dry runs, and release-note review pass. Generated artifacts are built from tagged source.

## Project scope

In scope:

- prompt refinement and execution briefs;
- bounded graph planning and orchestration;
- Codex and Claude Code adapters;
- gates, reconciliation, persistence, grading, and evaluation;
- CLI, MCP, and loopback-first HTTP interfaces.

Out of scope:

- claiming parity with private vendor internals;
- hosting a public multi-tenant control plane;
- storing provider credentials;
- bypassing vendor permissions or human approval.
