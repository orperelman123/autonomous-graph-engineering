# Host compatibility

GraphVigil publishes a deterministic compatibility contract for Codex, Claude
Code, Cursor, GitHub Copilot CLI, and Hermes Agent. Run it offline:

```bash
npm run compatibility
```

The command validates
[`compatibility/host-matrix.v1.json`](../compatibility/host-matrix.v1.json)
against its public schema, requires every supported host exactly once, rejects
absolute and parent-traversal evidence paths, verifies that committed evidence
exists, and emits a strict deterministic report. It does not invoke a host,
provider, network service, or credential.

## Evidence levels

- `contract-only` proves repository-owned manifests, hooks or rules, skills,
  MCP configuration, runtime identity checks, and documentation are present.
  Its `testedVersions` and `liveEvidence` arrays must remain empty.
- `live-tested` requires at least one exact host version and a committed,
  sanitized evidence artifact. A version must never be inferred from a
  manifest, documentation link, CLI discovery, or one successful machine.

The initial matrix is deliberately `contract-only`. It establishes what the
repository can prove deterministically without overstating live compatibility.
Live host-version records should include the operating system, architecture,
shell, Node and npm versions, exact offline-safe command, sanitized outcome,
and date. Never commit credentials, home-directory paths, private repository
names, raw prompts, or provider transcripts.

## Updating the matrix

When adding or changing a host integration:

1. update the public matrix and both schemas;
2. add at least two repository-relative evidence paths;
3. add a regression or adversarial policy test;
4. run `npm run compatibility` twice and require byte-identical output;
5. run the full repository checks on Windows and Linux.

The matrix is a compatibility claim boundary, not a marketplace submission,
package publication, or endorsement by a host vendor.
