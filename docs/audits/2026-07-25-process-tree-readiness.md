# Process-tree timeout readiness audit

Date: 2026-07-25

## Scope

This bounded reliability milestone investigates the GraphVigil executor test
`timeout terminates the complete executor process tree`. It does not change
production executor behavior, timeout semantics, graph permissions, the
official external Atbash SDK boundary, or any previously recorded milestone
layer.

## Evidence and root cause

The original test gave the fixture process 150 ms to start Node.js, spawn a
descendant, and synchronously write `descendant.pid`. After the executor
correctly reported a timeout and completed process-tree cleanup, the test read
that file unconditionally.

Before the correction, five isolated Ubuntu/WSL trials produced:

- trials 1 and 2: failed with `ENOENT` while reading `descendant.pid`;
- trials 3 through 5: passed with the same source and command.

Three concurrent package trials passed in this bounded reproduction. Two
earlier complete concurrent Ubuntu acceptance runs failed at the same PID-file
read, while focused and deterministic serial acceptance had passed. The
variable result with identical runtime code is evidence of a fixture-readiness
race. It is not evidence that a created descendant survived cleanup: in the
failure case, the fixture had not proved that the descendant existed.

## Correction

The test now separates the two invariants:

1. A bounded readiness poll proves that the delayed fixture descendant exists
   before the test evaluates complete process-tree termination.
2. An adversarial case delays readiness beyond a short executor timeout and
   proves that timeout cleanup remains bounded and does not leave a false PID
   artifact.

The readiness poll is tied to a deadline and reports whether executor failure
preceded readiness. It does not add an unconditional sleep, disable test
concurrency, skip a platform, weaken the descendant-termination assertion, or
change production code. The existing output-limit regression remains in the
same runtime suite.

The first Windows stress trial then exposed a separate transient cleanup race:
all process assertions passed, but recursive removal received `EBUSY` while
Windows released the terminated process's working-directory handle. Two
immediately following trials passed. Repair round 1 enables Node's bounded
recursive-removal retry (`5` attempts, `50` ms retry delay) for the two timeout
fixture directories. This affects test cleanup only and preserves the failure
if the bounded retries are exhausted.

An intentionally overloaded final Windows rerun exposed a second fixture
ambiguity: the 50 ms timeout callback could itself be scheduler-delayed beyond
the one-second timer that represented missing readiness. Repair round 2 replaces
that timer with an explicit fixture mode that never starts the descendant. The
separate 100 ms delayed-start case continues to test late readiness. The
missing-readiness cleanup ceiling remains explicit and bounded at five seconds;
the executor timeout remains 50 ms.

## Verification protocol

Run the focused runtime suite repeatedly on Windows and Ubuntu, then run the
normal concurrent repository checks on both platforms and the deterministic
serial Ubuntu cross-check. Complete the repository evaluation, compatibility,
secret/private-path, link, package dry-run, dependency, and preserved-layer
fingerprint gates.

Remaining uncertainty is limited to host scheduling beyond the explicit
three-second readiness deadline. Such a failure now produces a readiness
diagnostic rather than an unrelated missing-file assertion.

## Results

The pre-correction Ubuntu reproduction produced two `ENOENT` failures and
three passes across five focused trials. Three package-concurrent trials passed
in that same bounded run; two earlier full concurrent Ubuntu acceptance runs
had failed at the identical unconditional PID-file read.

After the correction:

- Windows focused runtime suite: `29/29` passed, followed by a three-trial
  stress run that exposed one cleanup-only `EBUSY`.
- Repair round 1: bounded recursive-removal retry added for the two fixture
  directories; five subsequent Windows trials passed.
- Ubuntu focused runtime suite: five trials passed before the cleanup-only
  repair, and the synced post-repair suite passed `29/29`.
- Normal concurrent `npm run check`: Windows exit `0`; Ubuntu exit `0`.
- Deterministic serial Ubuntu cross-check: exit `0`.
- Secret/private-path scan and local Markdown link check: passed.
- Prompt Refiner and Graph Engineer package dry-runs: passed without
  publication.
- Dependency audit: `0` vulnerabilities.

The bounded read-only graph
`001917cd-0cf2-4af0-a857-26d2b34f4d43` validated with local executors,
read/none permissions, no external node, and no human gate. Its first node was
blocked by the configured external security provider. No gate or profile was
changed. The audit path is
`.graph-runs/afa07279-7129-4155-a4a7-719238ab7fa0.jsonl`.

Final preservation evidence:

- `HEAD` and `origin/main`:
  `c9b42f46bc89fe21b3e0ac6d19cd5603836a85e3`
- staged compatibility diff:
  `a1b2d958f4f8df60e17c63fc0a20f861722ac618`
- extension tracked diff:
  `55153a7bf665fdc4bc419b6e1cb1d45bae41b41e`
- extension manifest:
  `24ea7a74f9ca3482ecee9db569ca4c034fc43149`, with unchanged blobs
  `634ca34be35f1b145c2b3061d97a49fcc2c7370f`,
  `72ce74458714fa7adf69cccdce0b6fe1bfe0c5c7`,
  `418f6c154bccb3138e8a2d6b101529a71fdbe6ab`, and
  `c7382d0a351b65cfcce5975b600ba2d0ff1cabbb`
- community-template provenance tree:
  `a652e1ac51c5b591df67452d204e82b5cf14c080`
- local-dashboard tree:
  `0acc19e463c38a07d3eab0779bc3777048707764`
- this reliability milestone tree:
  `d2130a4dfa1249631559ed6e76317e8c16f9807a` before this final results
  section was appended

No production executor, Atbash integration, graph budget, human gate,
checkpoint, reconciliation, output-limit, runtime-identity, or prior milestone
file was changed.
