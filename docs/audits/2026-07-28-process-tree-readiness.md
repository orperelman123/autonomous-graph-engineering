# Process-tree timeout readiness audit

Date: 2026-07-28

## Decision

The highest-value isolated repository-local milestone after merged main
`015f3be90ea6cb4ce04c21967060c61bf33a38f2` is to remove ambiguity from the
executor process-tree timeout test harness. The existing test can read
`descendant.pid` before the fixture has created it, especially under aggregate
host load. That makes a fixture-readiness race look like a cleanup failure.

This ranks above the remaining documentation and adoption work because the
failure is already observed on both Windows aggregate runs and isolated Ubuntu
trials and affects a safety-critical timeout invariant.

## Contract

- A read-only or deterministic node failure fails only its dependency branch.
- A graph-wide token or deadline ceiling stops remaining graph work.
- Neither failure mode creates or waits on a human gate.
- Only an explicit `human_gate` node can return `needs_confirmation`.

Those semantics are already covered by the merged runtime regression suite.
This milestone strengthens the lower-level executor timeout evidence without
changing them.

## Correction

The fixture can now delay descendant startup or intentionally omit it. The
positive process-tree test polls a PID readiness artifact against a three-second
deadline before evaluating cleanup. A separate adversarial test proves that a
50 ms executor timeout leaves no PID artifact when descendant readiness never
occurs. An initial five-second test-only cleanup envelope was disproved on the
saturated Windows host at about 5.8 seconds; repair round 1 retains a hard
15-second envelope without changing the executor timeout. Both fixture
directories use Node's bounded recursive-removal retry on Windows.

The positive readiness case then exceeded two outer observation windows (30
and 60 seconds). Source inspection identified the product-level cause:
`taskkill.exe` and the PowerShell cleanup fallback had no deadlines. Repair
round 2 bounds each helper at five seconds and makes fallback descendant
discovery query only the active process tree. If neither helper proves cleanup,
the executor kills the direct child and reports a cleanup failure instead of
remaining mid-run indefinitely.

No unconditional sleep, test skip, graph budget change, permission change,
gate approval, provider call, or proprietary Atbash source is introduced.
Hermes uses the same GraphVigil executor timeout contract, so the documented
result applies to Hermes without a host-specific runtime fork.

## Verification

Run the focused timeout cases repeatedly, the complete Windows repository gate,
an isolated Ubuntu gate, evaluation, compatibility, secret/private-path, link,
package dry-run, dependency, and protected GitHub checks. Preserve the original
dirty worktree fingerprints throughout.

## Local results

- Windows focused policy regressions: `5/5` passed.
- Windows timeout stress after repair round 2: three trials, `2/2` passed in
  each trial.
- Windows complete `npm run check`: exit `0`; graph package `70/70`, Prompt
  Refiner `28/28`, and repository contracts passed.
- Windows secret/private-path and link checks: passed.
- Windows offline provider-envelope compatibility: passed without network.
- Windows package dry-runs: both packages passed; nothing published.
- Windows dependency audit: `0` vulnerabilities.
- Isolated Ubuntu 22 / Node 22 complete gate:
  `/tmp/graphvigil-readiness.NY8zVW`, exit `0`; full check, scans, offline
  compatibility, both package dry-runs, and dependency audit passed.

The first Ubuntu isolation attempt excluded Git metadata and therefore failed
only the readiness test that invokes `git ls-files`; the corrected isolated
repository initialized a temporary Git index and passed `41/41` repository
contracts. No production code changed for that harness correction.

The original worktree remained on
`c9b42f46bc89fe21b3e0ac6d19cd5603836a85e3`, with `origin/main` at
`015f3be90ea6cb4ce04c21967060c61bf33a38f2`. Before and after this milestone,
its staged diff was `a8cb601df78b948ecd4bb29e3799c5a2ea3ca133`,
its unstaged diff was `af401068cd85291b454837f32e3b92661788f9e6`,
and the 22-file untracked manifest was
`e9cae1efba33983e6c9f4bd7688011f55512f143`.
