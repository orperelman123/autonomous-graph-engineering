# Branch-local failure boundary audit

Date: 2026-07-28

## Evidence and decision

A focused two-branch reproduction proved that an ordinary read-only executor
failure prevented an independent branch from running. That behavior made a
node-local failure indistinguishable from a graph-global ceiling.

The corrected contract is:

- only a declared `human_gate` returns `needs_confirmation`;
- a failure in a `none` or `read` node fails that node, skips its transitive
  descendants, and allows independent branches to finish;
- graph-wide token exhaustion and the graph deadline stop the complete run;
- potentially side-effecting failures remain graph-scoped so checkpoint and
  reconciliation protections are not weakened;
- after independent work finishes, any branch failure preserves the compatible
  terminal run status `failed`.

The Windows aggregate-runner concern was investigated before delivery. After
removing orphaned test invocations, the aggregate runtime suite passed `34/34`
and the complete graph-engineer package passed `82/82`, both exiting normally.
No product change was made for a non-reproduced runner defect.

## Implementation and coverage

Failed node state and audit events now record
`failureScope: "branch" | "graph"`. Dependency skips emit `node_skipped` in
topological order and are checkpointed before scheduling continues. A gated
resume preserves earlier branch failures and skips without replaying them.
Portable reports and their strict public JSON Schema expose the structural
scope without adding executor output or other free text.

Focused tests cover transitive skips and mixed joins, independent gate resume,
graph-global token exhaustion, watchdog timeouts, side-effect reconciliation,
budget checkpoint resume, report redaction, and schema compatibility.

Hermes Agent uses the same Graph Engineer MCP runtime and therefore receives the
same scheduler semantics. Its skill-write approval remains a separate host
control and is not treated as a graph gate.

## Repair rounds and acceptance

The additional side-effect adversarial test initially assumed an independent
node could not already have completed before a graph-scoped write failure.
Repair round 1 corrected the invariant to future scheduling, not rollback.
The next run exposed the validator's deterministic lexicographic topological
order. Repair round 2 made the intended ordering explicit through node IDs.
The resulting test proves that an approved side-effect failure is graph-scoped,
does not manufacture a gate, and leaves later independent work pending. No
product behavior was changed during either test-only repair.

The exact final source passed:

- Windows `npm run check`, including `69/69` graph-engineer tests, `21/21`
  graph evaluations, `30/30` prompt evaluations, and the Hermes adapter tests;
- isolated Ubuntu `npm run check` against
  `/var/tmp/graphvigil-branch-failure-20260728g`;
- Windows and Ubuntu secret/private-path and local Markdown link checks;
- both package dry-runs without publication;
- dependency audit with `0` vulnerabilities;
- `git diff --check`.

One Ubuntu run performed concurrently with the final Windows gate hit the
preexisting timeout-fixture readiness race while every new test passed. The
unchanged exact source then passed the complete Ubuntu gate when run alone.
No unrelated timeout-fixture milestone was absorbed into this changeset.

## Preserved boundaries

No permission, gate, graph budget, checkpoint fingerprint, reconciliation,
output limit, runtime identity, security-provider, or official external Atbash
SDK boundary is relaxed. No package is published, no release or marketplace
submission is created, no paid provider is called, and no proprietary Atbash
source is copied.

Prompt Refiner reported version `0.3.3` and `current`. Graph Engineer reported
version `0.3.3` with `reload_required`, so no generated graph was started and
the managed runtime was not mutated.

The source milestone is isolated on
`codex/branch-local-failure-boundaries` from baseline
`c9b42f46bc89fe21b3e0ac6d19cd5603836a85e3`. The original layered worktree is
preserved separately and is not part of this changeset.
