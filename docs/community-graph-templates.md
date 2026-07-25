# Community graph templates

Community templates are versioned, repository-local wrappers around ordinary
GraphVigil graphs. The wrapper records where a graph came from, who maintains
it, its SPDX license, a canonical SHA-256 digest, and conservative host
compatibility metadata.

The first contract is intentionally read-only. A community template:

- validates against
  [`community-graph-template.schema.json`](../schemas/community-graph-template.schema.json)
  and the normal autonomous graph schema;
- passes the runtime graph validator;
- uses only `plan_only` or `read_only` autonomy and `none` or `read`
  permissions;
- contains no human gate, external node, write node, private path, credential,
  or oversized budget;
- matches both its canonical digest and its repository-relative origin graph;
- may claim only `contract-only` compatibility for a supported host.

`contract-only` means the repository integration contract exists. It does not
claim that a particular live host version was tested. The public host ids are
`codex`, `claude`, `cursor`, `copilot`, and `hermes`.

## Verify offline

Build the graph runtime, then verify every template deterministically:

```sh
npm run build
node scripts/verify-community-templates.mjs
```

The command reads repository files only, makes no provider or network call, and
prints a report conforming to
[`community-template-report.schema.json`](../schemas/community-template-report.schema.json).
It returns a nonzero exit code when any template fails.

Hermes uses the same template files and verification command as the other
hosts. Follow the existing [Hermes installation](installation.md#hermes-agent)
instructions for its generated MCP and skill configuration. The template
contract does not place prompts or authorization in Hermes configuration.

## Atbash boundary

Atbash remains an optional, official external authorization provider for graph
execution. Templates do not vendor Atbash, contain credentials, or imply
authorization. When Atbash is enabled, its decision remains fail-closed and
independent of template schema validation. See
[External security providers](external-security-provider.md#native-atbash-sdk).

## Contribute or migrate a template

1. Start with a sanitized graph already committed under `examples/`.
2. Copy the graph into a new `templates/*.template.json` wrapper.
3. Record an HTTPS origin repository, normalized repository-relative path, full
   40-character source revision, SPDX license, and stable maintainer ids.
4. Compute `provenance.graphSha256` from canonical JSON: recursively sort object
   keys, preserve array order, serialize without whitespace, then hash the UTF-8
   bytes with SHA-256.
5. Declare only hosts whose repository contracts are supported. Keep their
   status `contract-only`; live evidence belongs in the host compatibility
   matrix.
6. Run the offline verifier, the focused adversarial tests, and the complete
   repository check.

Existing bare graphs remain valid. Migration adds a wrapper; it does not change
the graph schema or grant new permissions. A digest change requires reviewing
the graph change and updating the origin revision. Duplicate ids, traversal,
tampering, private paths, unsupported compatibility claims, and unsafe budgets
are rejected.
