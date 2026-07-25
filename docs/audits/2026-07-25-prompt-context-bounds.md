# Prompt context trust-and-bounds audit

Date: 2026-07-25

## Scope

This audit measures caller-supplied `RefineRequest.context` and rendered
execution-brief growth across the deterministic compiler, optional semantic
provider, MCP, HTTP, hook, CLI, runner, and public package surfaces. It makes no
provider call, approves no gate, changes no runtime profile, and preserves every
previously fingerprinted milestone layer.

## Runtime and graph evidence

Both managed GraphVigil components reported version `0.3.3`, status `current`,
`reloadRequired: false`, and active installation
`9cae88dc-abcf-4155-9436-3e657e156ccd`.

Read-only graph `a55ba318-7d5c-43aa-91ef-e443b4237e32` validated with six local
nodes, read/none permissions, no external node, and no human gate. Run
`0c9e49f8-678c-4f10-ba57-8dbb5dec5d13` stopped at its first node because the
configured external security provider blocked the executor. It used zero
repair rounds. No provider substitution or configuration change was made. The
audit path is
`.graph-runs/0c9e49f8-678c-4f10-ba57-8dbb5dec5d13.jsonl`.

## Reproduction

A 19-character request (`Review the parser.`) rendered to 1,309 effective-prompt
bytes without context. The same request with six caller context fields, using
100,000-character scalar values and 100 entries for each array field, produced:

- 30,302,271 effective-prompt bytes;
- 60,604,646 serialized result bytes;
- 105 execution-brief context entries; and
- 100 preserved duplicate instructions.

A runtime caller bypassing TypeScript supplied an object as `projectName`, a
number in `frameworks`, and duplicate strings plus a number in `instructions`.
The compiler accepted them as:

```text
Project: [object Object]
Detected stack: typescript, 42
same
same
17
```

The compiler's 100,000-character limit applies only to `request.prompt`.
`PromptContext` has compile-time types but no runtime normalization or budget.
The public result schema's generic string arrays and `effectivePrompt` also
have no item, string, or byte limits. HTTP limits the complete request body to
1 MB, while the direct package API has no transport ceiling. MCP and hooks
derive a smaller context shape from an explicit `cwd`, but they ultimately call
the same compiler/provider path. Semantic refinement serializes the
deterministic draft before a provider call, so the unbounded draft is also its
input boundary.

## Evidence ranking

| Rank | Candidate | Evidence | Impact | Cost and risk |
| --- | --- | --- | --- | --- |
| 1 | Normalize and bound caller context plus effective-prompt bytes | Direct 30.3 MB expansion, malformed values, duplicates, and semantic draft amplification reproduced | High reliability and caller-attribution impact across public API and HTTP; shared downstream risk | Medium, but requires the shared compiler/provider boundary |
| 2 | Add output-only JSON Schema limits | Unbounded public schema reproduced | Medium; documents a contract but cannot enforce direct runtime calls | Low |
| 3 | Further restrict derived filesystem context | MCP/hooks already require explicit `cwd` and emit a small fixed framework set | Low incremental impact | Low |

The leading finding survives disproof against the HTTP body ceiling because the
public package API has no equivalent ceiling and the rendered result expands
the accepted input. Schema-only limits do not correct runtime behavior.

## Preserved-layer conflict

The only complete fail-closed interception point is the shared deterministic
compiler before it constructs the brief, followed by the semantic provider
boundary and transport assertions. However, the active goal simultaneously
requires the exact prompt-permission-context tree fingerprint
`24af71f5db4d1bf6949aa4c4b1eedfcd1ec800dc` to remain unchanged and explicitly
stops on any preserved-layer change. That tree contains:

- `packages/prompt-refiner/src/compiler.ts`;
- `packages/prompt-refiner/src/provider.ts`;
- `packages/prompt-refiner/src/mcp-server.ts`;
- `packages/prompt-refiner/src/server.ts`; and
- their focused cross-surface tests.

Adding a parallel public wrapper would leave direct imports and the existing
HTTP, MCP, CLI, runner, and semantic-provider call graph unprotected. Modifying
only types or JSON Schema would not enforce runtime bounds.

## Additive policy preparation

The reusable policy was implemented outside every preserved layer in
`packages/prompt-refiner/src/context-policy.ts`. It:

- accepts only the six version-1 `PromptContext` fields;
- rejects malformed, blank, oversized, and unknown metadata;
- preserves valid string values exactly and deduplicates exact array entries
  in first-seen order;
- limits scalar values to 8,192 characters, arrays to 32 entries, array values
  to 1,024 characters, rendered context to 65,536 UTF-8 bytes, and effective
  prompts to 1,048,576 UTF-8 bytes;
- distinguishes caller, explicit-working-directory, and process-working-
  directory attribution without placing a forgeable source property in the
  caller object; and
- freezes normalized and filesystem-derived metadata so attribution cannot be
  retained while values are mutated.

`collectContext` marks its source out of band. The public package exports the
normalizer, renderer, budget assertion, limits, and read-only source
inspection, but deliberately does not export the provenance-marking function.
The package test command includes the new adversarial policy corpus.

This preparation is not represented as completed cross-surface enforcement.
The locked compiler still calls its original private `contextLines`, and its
existing provider, MCP, and HTTP paths therefore do not yet invoke the new
normalizer or effective-prompt assertion.

## Repair rounds and focused verification

Repair round 1 corrected only an aggregate-limit test fixture. The initial
emoji fixture reached the scalar UTF-16 character ceiling before the intended
aggregate UTF-8 byte ceiling. The replacement uses maximum-sized distinct
array entries and proves the aggregate guard directly.

Repair round 2 followed an independent trust-boundary disproof. The first
policy draft exported its provenance marker and left attributed objects
mutable. The repaired design keeps the marker internal to the package,
freezes attributed objects and their arrays, proves callers cannot forge the
public source marker, and proves cloned or serialized values revert to caller
attribution. This exhausts the two-round repair budget.

Focused results after repair round 2:

- Windows policy suite: `8/8` passed.
- Windows complete Prompt Refiner suite: `39/39` passed.
- Windows pre-repair bounded stress: five policy trials passed.
- Isolated Ubuntu policy suite: three consecutive post-repair trials passed.
- Isolated Ubuntu complete Prompt Refiner suite: `39/39` passed.
- Windows and Ubuntu Prompt Refiner typechecks passed.

One intermediate Ubuntu stress launch failed before test execution with WSL
`HCS_E_CONNECTION_TIMEOUT`; a fresh isolated Ubuntu trial then passed. This was
a host-start failure, not a product repair round.

## Required resolution

Implementation can proceed only after the preserved-layer constraint is
explicitly rebaselined to allow a new additive change to the shared Prompt
Refiner boundary. The mandated two-repair-round stop condition is also now
reached. Until a fresh goal explicitly rebaselines the locked layer and its
repair budget, the evidence-backed milestone cannot truthfully satisfy its
cross-surface acceptance criteria. Complete repository gates were not run
because the runtime integration remains intentionally absent.

## Explicit rebaseline and integration

The successor goal explicitly reclassified
`24af71f5db4d1bf6949aa4c4b1eedfcd1ec800dc` as a historical baseline. It
authorized only the smallest Prompt Refiner integration, schema, focused-test,
package-test-registration, and documentation path set required to complete the
context-bounds milestone. No Git staging, commit, push, pull request,
publication, provider call, live-profile mutation, gate approval, destructive
action, or proprietary Atbash source access was authorized.

Before integration, runtime identity remained `0.3.3/current`, HEAD and
`origin/main` remained `c9b42f46bc89fe21b3e0ac6d19cd5603836a85e3`,
and the primary index remained
`c9acd7585a35c7ba961b48cb4e2647b1e755ca43`.

The exact authorized path set was:

- `packages/prompt-refiner/src/compiler.ts`;
- `packages/prompt-refiner/src/provider.ts`;
- `packages/prompt-refiner/src/context-policy.ts`;
- `packages/prompt-refiner/src/context.ts`;
- `packages/prompt-refiner/src/index.ts`;
- `packages/prompt-refiner/package.json`;
- focused tests under `packages/prompt-refiner/test`;
- `schemas/prompt-refinement.schema.json`;
- `packages/prompt-refiner/README.md`;
- `docs/interfaces.md`; and
- this audit record.

All other dirty, staged, and untracked repository layers remained outside the
authorized write set.

Validated read-only graph `87959711-e429-49c1-a548-c666f4a3629e` used local
read/none nodes, no external node, and no gate. Run
`396f60dc-c9aa-4f88-97c6-d49d8ec43d4d` was blocked at node one by the external
security provider. It executed no audit node and consumed zero repair rounds.
The failure was preserved rather than bypassed; direct local repository
inspection supplied the path evidence.

The deterministic compiler now invokes the prepared normalizer before building
the execution brief and enforces the final UTF-8 effective-prompt budget.
Because every semantic, HTTP, MCP, hook, CLI, runner, and wrapper path converges
on `refinePrompt` and `compilePrompt`, malformed or oversized caller context now
fails closed consistently. Semantic results are rendered through the same byte
guard; an oversized provider projection falls back to the bounded deterministic
result. The public result schema documents bounded context entries and an
effective-prompt character ceiling, while runtime byte checks remain
authoritative.

Successor repair round 1 updated the MCP filesystem-attribution expectation
after focused verification exposed the intentional new context line. The same
round added an adversarial semantic-output budget test. No second successor
repair round has been used.

Focused Windows verification after successor repair round 1:

- Prompt Refiner typecheck passed;
- Prompt Refiner tests: `41/41` passed; and
- public schema-contract tests: `10/10` passed.

Complete successor verification:

- Windows `npm run check`: exit `0`; graph-engineer `77/77`, Prompt Refiner
  `41/41`, root `48/48`, all evaluations, five-host compatibility including
  Hermes, and final builds passed.
- The first isolated Ubuntu trial passed graph-engineer `77/77` and Prompt
  Refiner `41/41`, then failed one root launch-readiness assertion because the
  test copy deliberately omitted `.git`. This was a verification-fixture
  failure before product execution, not a code defect or repair round.
- The first isolated copy at `/tmp/graphvigil-promptcontext-8LIn24` was
  replaced by `/tmp/graphvigil-promptcontext-kfZY8d`, a fresh trial initialized
  with a local test-only Git index before dependency installation.
  Its `npm run check` exited `0`: graph-engineer `77/77`, Prompt Refiner
  `41/41`, root `48/48`, all evaluations, five-host compatibility including
  Hermes, and final builds passed. Only local CRLF-to-LF warnings appeared.
- Secret/private-path scan and local Markdown-link check passed.
- Prompt Refiner and Graph Engineer package dry-runs passed without
  publication.
- Dependency audit found `0` vulnerabilities.
- `git diff --check` passed.
- Post-integration Prompt Refiner stress passed `5/5` on Windows and `5/5` in
  a fresh isolated Ubuntu copy at
  `/tmp/graphvigil-promptcontext-stress-dtkEPm`; the same isolated execution
  also passed the complete Prompt Refiner suite with test concurrency fixed at
  one.

Final preservation evidence:

- HEAD and `origin/main`:
  `c9b42f46bc89fe21b3e0ac6d19cd5603836a85e3`;
- primary index:
  `c9acd7585a35c7ba961b48cb4e2647b1e755ca43`; and
- staged compatibility diff:
  `a1b2d958f4f8df60e17c63fc0a20f861722ac618`.

The new post-integration PromptContext milestone fingerprint is
`a21f41fb421d6bc0b7a09ee097b6d18a83e61346`. It is the SHA-1 of a
path-sorted UTF-8 manifest containing each repository-relative path and file
SHA-1 for the 16 integrated implementation, focused-test, schema, and developer
documentation files listed above, excluding this self-referential audit.

No second successor repair round was used. Remaining uncertainty is limited to
natural-language and runtime-input shapes outside the bounded corpus; the
compiler rejects unknown context fields and malformed values before any
downstream surface can use them.
