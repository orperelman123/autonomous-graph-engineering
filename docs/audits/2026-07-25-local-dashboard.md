# Local dashboard milestone audit

Date: 2026-07-25

## Preserved baseline

- `HEAD` and `origin/main`:
  `c9b42f46bc89fe21b3e0ac6d19cd5603836a85e3`
- staged compatibility layer: 15 paths, diff fingerprint
  `a1b2d958f4f8df60e17c63fc0a20f861722ac618`
- extension tracked diff:
  `55153a7bf665fdc4bc419b6e1cb1d45bae41b41e`
- extension untracked manifest:
  `24ea7a74f9ca3482ecee9db569ca4c034fc43149`
- community-template provenance tree:
  `a652e1ac51c5b591df67452d204e82b5cf14c080`

The primary Git index hash was unchanged during verification. The dashboard
milestone uses new paths plus `packages/graph-orchestrator/src/cli.ts`,
`packages/graph-orchestrator/src/report.ts`,
`packages/graph-orchestrator/test/interfaces.test.ts`, and
`docs/development.md`. None overlaps a preserved layer.

## Evidence ranking

| Rank | Candidate | Direct evidence | Impact | Safety risk | Cost |
| --- | --- | --- | --- | --- | --- |
| 1 | Optional local dashboard | Unchecked roadmap item; the redacted portable report producer and strict schema already provide a safe input boundary | High | Medium | Medium |
| 2 | Sanitized live host records | Unchecked roadmap item, but valid records require external host/version evidence excluded from this repository-only milestone | Medium | Medium | Medium |
| 3 | Additional adapters | Roadmap requires contributor demand; the current compatibility matrix already covers five hosts and no repository evidence identifies another demanded host | Low | Medium | High |
| 4 | Provider-backed outcomes | Requires separately excluded paid provider calls and external evidence | High | High | High |

The dashboard survives disproof. A dashboard can create a broad web trust
boundary, but a fixed-route loopback-only viewer over already redacted
structural reports avoids arbitrary file serving, providers, credentials, and
mutations. The other candidates cannot be completed from repository evidence
alone.

## Graph audit

Read-only graph `24bf671d-26e5-4b13-ba9b-9fb62e8ef3a5` validated with six
nodes, depth six, bounded budgets, local executors, read/none permissions, no
external node, and no human gate. Its first node was blocked by the configured
external security provider. No gate was approved and no profile was changed.
The preserved audit path is
`.graph-runs/96e0818a-e891-424a-a23b-501cd5254399.jsonl`.

## Acceptance criteria

- Bind only to loopback and expose fixed read-only routes.
- Consume the existing portable-report producer from already size-checked,
  contained, regular artifact bytes.
- Emit a strict versioned snapshot with deterministic ordering and explicit
  truncation.
- Cap run count, artifact sizes, and response size.
- Reject traversal, symlinks, malformed and changing files, duplicate
  identities, and unsupported compatibility claims.
- Render user-controlled values with DOM `textContent` under a deny-by-default
  Content Security Policy.
- Expose budgets, usage, recorded cost, verifier state, staleness, and integrity
  without prompts, outputs, reasons, event data, paths, credentials, or raw
  errors.
- Document identical local use across Codex, Claude Code, Cursor, Copilot, and
  Hermes while preserving the official external Atbash boundary.
- Pass focused adversarial tests, one bounded repair round, complete Windows
  and isolated Linux gates, and final immutable-layer verification.
