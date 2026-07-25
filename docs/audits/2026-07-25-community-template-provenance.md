# Community template provenance milestone audit

Date: 2026-07-25

## Preserved baseline

- `HEAD` and `origin/main`:
  `c9b42f46bc89fe21b3e0ac6d19cd5603836a85e3`
- staged compatibility layer fingerprint:
  `a1b2d958f4f8df60e17c63fc0a20f861722ac618`
- unstaged extension tracked-diff fingerprint:
  `55153a7bf665fdc4bc419b6e1cb1d45bae41b41e`
- unstaged extension manifest fingerprint:
  `24ea7a74f9ca3482ecee9db569ca4c034fc43149`

The provenance milestone uses only new paths plus
`docs/community-contributions.md` and `test/example-workflows.test.ts`. It does
not overlap either preserved change layer.

## Evidence audit

| Rank | Candidate | Evidence | Impact | Safety | Cost |
| --- | --- | --- | --- | --- | --- |
| 1 | Community graph templates with schema validation and provenance | Explicit unchecked roadmap item; four validated example graphs exist; both prior milestone audits independently rank the missing contract | High | High | Medium |
| 2 | Optional local dashboard | Explicit roadmap item and portable reports provide input, but a UI adds a larger trust boundary | Medium | Medium | High |
| 3 | Additional adapters | Roadmap requires contributor demand; no repository evidence identifies a missing requested host after five-host compatibility | Low | Medium | High |

The leading candidate survives disproof: a dashboard is more visible but creates
a larger parsing and serving surface; another adapter lacks the roadmap's demand
evidence; provider-backed benchmarking requires separately excluded paid calls.
The template contract is one coherent repository-local milestone and does not
depend on external publication.

## Graph audit evidence

The read-only audit graph
`b36d9be5-cbf4-4827-a308-bbb406928aba` validated with six nodes, depth six,
read/none permissions only, local executors, no external node, and no human
gate. Execution stopped before its first node because the configured external
security provider blocked execution. The preserved audit is
`.graph-runs/ea657c34-e90b-424b-8028-3096257e9fa9.jsonl`. No gate was approved
and no security profile was changed.

## Acceptance criteria

- A strict versioned public template schema composes the normal graph schema.
- Provenance records HTTPS origin, normalized repository-relative path, full
  source revision, SPDX license, maintainers, and canonical graph SHA-256.
- Schema and runtime graph validation both pass.
- Templates are read-only, budget-capped, private-data-safe, and contain no
  human, external, write, or destructive node.
- Host metadata includes Hermes without claiming a live tested version.
- Deterministic offline verification emits a strict public report.
- Regression tests reject tampering, traversal, private paths, duplicates,
  unsafe budgets, invalid runtime graphs, and unsupported host claims.
- Contribution and migration documentation preserves the official external
  Atbash SDK boundary.
- Complete Windows and isolated Linux gates pass without changing the preserved
  baseline layers.
