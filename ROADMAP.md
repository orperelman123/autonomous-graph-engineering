# Roadmap

Autonomous Graph Engineering is early and intentionally safety-first. This roadmap prioritizes a trustworthy first success before adding more autonomy.

## Now: make the first run effortless

- [x] Deterministic prompt refinement and graph planning
- [x] Codex and Claude Code executors
- [x] MCP, CLI, and authenticated loopback HTTP interfaces
- [x] Budgets, checkpoints, audit events, human gates, and reconciliation
- [x] Codex plugin and Claude Code marketplace manifests
- [ ] One-command installer and doctor for every supported agent
- [ ] A 30-second terminal demo and copy-paste starter graph
- [ ] Clear diagnostics for missing CLIs, authentication, and MCP registration

## Next: prove outcomes

- [ ] Publish a reproducible benchmark comparing direct execution, a bounded loop, and a validated graph
- [ ] Add real-world example packs for repository audit, implementation, migration, and release preparation
- [ ] Export a portable run report with graph, budgets, verifier result, usage, and redacted evidence
- [ ] Test a compatibility matrix across supported Codex and Claude Code versions

## Later: grow the ecosystem safely

- [ ] Stable extension API for executors and graders
- [ ] Community graph templates with schema validation and provenance
- [ ] Optional local dashboard for runs, checkpoints, and costs
- [ ] Additional agent adapters based on contributor demand

## Good first contributions

- Improve an error message or installation diagnostic.
- Add a deterministic prompt-refinement evaluation case.
- Add a redacted example graph for a real workflow.
- Test installation on a new operating system and document the result.
- Challenge a safety claim with a minimal failing test.

Open a [feature request](https://github.com/orperelman123/autonomous-graph-engineering/issues/new/choose) before taking a larger item. Security reports must follow [SECURITY.md](SECURITY.md).
