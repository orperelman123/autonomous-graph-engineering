# Extension API milestone audit

Baseline: `c9b42f46bc89fe21b3e0ac6d19cd5603836a85e3`, plus the immutable staged
five-host compatibility milestone with diff fingerprint
`a1b2d958f4f8df60e17c63fc0a20f861722ac618`.

The generated read-only audit graph `960ad95a-ad14-43af-978c-0008a70de434`
was not executed. Validation correctly rejected its inferred external node with
`PERMISSION_EXCEEDS_AUTONOMY`; no human gate was approved.

## Evidence ranking

| Rank | Candidate | Evidence | Impact | Safety | Cost and risk |
| --- | --- | --- | --- | --- | --- |
| 1 | Stable executor and grader extension API | `GraphExecutor` is public and `runGraph` accepts injected objects, but graph types, schema, and validator hard-code three executor names; `gradeCheckpoint` has no extension input | High | High if names, permissions, results, and grader output fail closed | Medium |
| 2 | Community template provenance | Four validated examples exist, but no community provenance contract exists | Medium | High | Medium |
| 3 | Optional local dashboard | Portable run reports provide a safe input, but no UI boundary exists | Medium | Medium | High |

The leading candidate was challenged against template provenance. Provenance
would protect contributed data, but it would not unlock the already-present
programmatic executor injection or make grading extensible. A bounded registry
closes both inconsistent public boundaries without changing scheduling,
persistence, reconciliation, or gate semantics.

## Acceptance criteria

- Custom executor names validate in TypeScript, JSON Schema, and runtime code.
- Built-in and prototype-sensitive names cannot be overridden.
- Each executor has an explicit permission allowlist and malformed results fail
  closed.
- Optional security-provider wrapping preserves the hash-only authorization
  boundary.
- Graders run serially against cloned frozen evidence and produce bounded,
  namespaced, duplicate-free criteria.
- Built-in executors and the existing two-argument `gradeCheckpoint` call remain
  compatible.
- Focused adversarial tests and the complete Windows/Linux gates pass.
- The staged compatibility diff retains its original path set and fingerprint.
