# Contributing

Thank you for improving Autonomous Graph Engineering.

Choose a bounded contribution type and its acceptance criteria in [Community contribution paths](docs/community-contributions.md) before opening a larger change.

## Development setup

```bash
npm ci
npm run check
```

Node.js 20 or newer is required. Deterministic tests do not require provider credentials.

## Change workflow

1. Open or reference an issue for significant changes.
2. Create a focused branch.
3. Preserve public contracts unless the change explicitly includes a migration.
4. Add a regression test for every behavioral fix.
5. Update architecture, security, interface, or evaluation documentation when behavior changes.
6. Run:

   ```bash
   npm run check
   npm run secret-scan
   npm run link-check
   ```

7. Open a pull request using the repository template.

## Safety invariants

Changes must not:

- modify or replace the original user request;
- infer permissions not present in the request;
- permit a gate to elevate autonomy;
- allow external or destructive actions without fingerprint-bound approval;
- expose approval or reconciliation through an agent-controlled MCP tool;
- replay ambiguous side effects automatically;
- bypass graph validation or hard budgets;
- treat model output as orchestration instructions;
- commit credentials, checkpoints, transcripts, or user-specific paths.

Proposals that intentionally change an invariant require a threat-model update and explicit maintainer review.

## Tests

Keep tests deterministic by default. Live Codex, Claude, OpenAI API, or Anthropic API calls must be opt-in and must not run in pull-request CI.

Use minimal fixtures and remove generated artifacts. Do not record real credentials or private repository content.

## Commit and pull-request style

- Prefer small, coherent commits.
- Use imperative commit subjects.
- Explain user impact and security impact.
- Document validation commands and results.
- Mark breaking contracts clearly.

## Reporting vulnerabilities

Do not open public issues for suspected vulnerabilities. Follow [SECURITY.md](SECURITY.md).
