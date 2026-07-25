# Prompt permission and context audit

Date: 2026-07-25

## Scope

This milestone is limited to deterministic permission classification and
caller-supplied project context in Prompt Refiner. It preserves the official
external Atbash SDK boundary and does not change graph execution, human gates,
provider configuration, credentials, or any prior milestone layer.

## Pre-correction evidence

The managed v0.3.3 deterministic MCP runtime repeatedly refined a bounded
repository-local investigation into a brief containing both
`elevated_access` and `Project: autonomous-finops-control-plane`, despite the
request explicitly denying elevated access and naming a different nested
repository.

The source corpus isolated two causes:

1. Permission detection matched bare vocabulary. Read-only prompts containing
   `root cause`, `admin dashboard`, or `root certificate` all requested
   `elevated_access`.
2. MCP, context-less HTTP refinement, and hooks without `cwd` collected the
   server process's ambient working-directory metadata. The reported project
   was real for the launch directory but unrequested and unrelated to the
   nested repository in scope.

Optional semantic refinement was not the source of the observed result: the
tool reported `provider: deterministic`. Semantic permission changes already
failed closed, but semantic context additions were not protected.

## Evidence ranking and disproof

1. Bare privileged vocabulary plus ambient context injection had direct,
   repeatable evidence on the exact active objective and three reduced prompts.
   It could expand permissions and misidentify the repository, so it ranked
   highest for safety and user impact at bounded implementation cost.
2. General consequential-action negation ranked lower because the existing
   mixed-list and positive-contrast corpora passed.
3. Wrapper option injection, `!raw`, and prompt-envelope injection ranked lower
   because existing regression tests already covered those boundaries.

The leading explanation survived disproof against true privileged requests:
approved admin access, sudo access, elevated permissions, `run as root`, and a
leading sudo command still request `elevated_access`. Explicit caller context
also remains available and exact. The two observed fields therefore came from
separate deterministic mechanisms, not a semantic provider or Atbash.

## Correction

- Elevated permission inference now requires execution intent coupled to
  privileged access, permissions, or an explicit `run as` form. Technical
  vocabulary alone is not authorization.
- Deterministic compiler context remains supported when a caller explicitly
  supplies it.
- MCP accepts optional `cwd` and otherwise emits no ambient project context.
- HTTP refinement emits only caller-supplied context. Hooks collect project
  context only from an explicit hook `cwd`.
- Semantic refinement must preserve context exactly, just as it must preserve
  permissions.

The regression corpus retains positive protection for sudo access, approved
admin access, elevated permissions, `run as root`, and a leading sudo command.
It rejects invented context and false permission inference across compiler,
semantic-provider, MCP, and hook/server surfaces while preserving `!raw`.

Focused repair round 1 corrected two test expectations after the implementation
proved the exact caller-supplied package context: the package-local manifest
does not directly declare TypeScript, and npm runs the server test from
`@autonomous-graph-engineering/prompt-refiner`. No product code changed in this
round.

The deterministic serial Ubuntu gate then exercised the same server test from
the repository root rather than npm's package-local working directory. Repair
round 2 makes the assertion derive the expected project from the exact supplied
`cwd`, proving both invocation modes without hard-coding either project name.
No product code changed in this round. The two-round repair budget is exhausted.

## Graph audit

Read-only graph `ca096f2e-fbc7-43fb-b4e1-cfc40ef1c77c` validated with six
nodes, local executors, read/none permissions, no external node, and no human
gate. Its first node was blocked by the configured external security provider.
No gate or profile was changed. The audit path is
`.graph-runs/e9ffc744-7ebb-4a58-9a5a-c7a79d665fee.jsonl`.

## Verification results

- Pre-correction bounded corpus: three technical-vocabulary false positives
  reproduced; true privileged-execution cases remained distinguishable.
- Post-correction disconfirming corpus: `10/10` passed.
- Focused Prompt Refiner suite after repair round 1: `31/31` passed.
- Bounded stress: Windows `5/5`; Ubuntu `5/5`.
- Repair round 2 focused server checks: Windows `1/1`; Ubuntu `1/1`.
- Final normal concurrent `npm run check`: Windows exit `0`; Ubuntu exit `0`.
- Final deterministic serial Ubuntu cross-check: exit `0`.
- Evaluations and five-host compatibility, including Hermes: passed.
- Secret/private-path scan and local Markdown link check: passed.
- Prompt Refiner and Graph Engineer package dry-runs: passed without
  publication.
- Dependency audit: `0` vulnerabilities.

The implementation changed only five Prompt Refiner source files, four focused
test files, and this audit. No package version, graph runtime, Atbash
integration, provider configuration, credential path, or prior milestone file
changed.

Remaining uncertainty is limited to natural-language forms outside the bounded
English corpus and to callers that explicitly provide an incorrect `cwd` or
context. Those values are now attributable to the caller rather than silently
inferred from the server launch directory.
