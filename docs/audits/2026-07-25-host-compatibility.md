# Host compatibility milestone audit

Baseline commit: `c9b42f46bc89fe21b3e0ac6d19cd5603836a85e3`

The read-only GraphVigil audit graph validated successfully but its first
executor was blocked by the configured external security provider. Run
`33f4e4b9-37c5-439e-b0d4-adf8b74939c7` made no repository changes and used no
repair round. The selection below therefore relies on direct, repository-local
evidence.

| Rank | Candidate | Repository evidence | Impact | Safety value | Cost | External risk |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Five-host compatibility contract and offline matrix | `ROADMAP.md` names the four-host gap; current code and docs support five hosts including Hermes; no public host-matrix schema or deterministic report existed | High | High: prevents unsupported compatibility claims and private-path evidence | Medium | Low |
| 2 | Stable executor and grader extension API | Roadmap item; executor and grader boundaries exist but are internal | High | Medium | High | Medium |
| 3 | Provenance contract for community graph templates | Roadmap item; validated examples exist without a community provenance schema | Medium | High | Medium | Low |
| 4 | Optional local dashboard | Roadmap item; portable reports provide input but no UI exists | Medium | Low | High | Low |
| Excluded | Provider-backed outcome benchmark | Explicit roadmap item, but requires external providers, credentials, cost, and nondeterministic evidence | High | Medium | High | High |

## Selected milestone

Publish a strict, deterministic, five-host compatibility contract and offline
evidence report. This closes the repository-evidence gap without claiming that
live host versions were exercised.

Acceptance criteria:

- Codex, Claude Code, Cursor, GitHub Copilot CLI, and Hermes Agent appear
  exactly once.
- Public matrix and report schemas reject undeclared fields.
- Repository evidence paths are relative, traversal-safe, unique, and present.
- Contract-only rows cannot claim tested live versions.
- Two executions produce byte-identical reports.
- The full test, evaluation, build, secret, link, package, dependency, and
  Windows/Linux CI-equivalent gates pass.

The leading candidate was challenged against the extension API: the extension
API has broader architectural value, but it has higher compatibility and
migration risk and lacks the explicit near-term roadmap evidence of the host
matrix. The host contract remains the smallest complete high-value milestone.
