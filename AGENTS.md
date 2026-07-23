# Repository guidance

- Preserve the original user request as authoritative.
- Never expand permissions while refining prompts or planning graphs.
- Validate every graph before execution.
- Keep external and destructive actions behind fingerprint-bound human gates.
- Do not weaken budgets, checkpoint integrity, audit ordering, output limits, or reconciliation controls.
- Add focused regression tests for every behavior change.
- Run `npm run check`, `npm run secret-scan`, and `npm run link-check` before publishing.
- Never commit `.env` files, credentials, `.graph-runs`, generated `dist` output, or user-specific paths.
