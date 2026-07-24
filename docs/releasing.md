# Release process

This project uses evidence gates. A release is not complete because a command
returned zero; every public artifact must be read back from its destination.

## Required gates

1. Choose one semantic version and update the root package, both workspace
   packages, plugin manifests, MCP server metadata, marketplace metadata, lock
   file, and changelog.
2. Start from `npm ci` and complete at least two independent local
   `npm run check` passes.
3. Stress any timing-sensitive regression and complete:

   ```bash
   npm run secret-scan
   npm run link-check
   npm audit --omit=dev --audit-level=high
   npm pack --dry-run --workspace @autonomous-graph-engineering/prompt-refiner
   npm pack --dry-run --workspace @autonomous-graph-engineering/graph-engineer
   ```

4. Push the release candidate and require the complete Windows/Linux CI,
   package, launch-readiness, and CodeQL matrix to pass.
5. Merge only the reviewed PR commit into the configured default branch.
6. Verify the default-branch commit and its post-merge CI before tagging.
7. Publish `prompt-refiner` before `graph-engineer`, because the graph package
   depends on the exact prompt-refiner version. Read both package versions back
   from the npm registry.
8. Create the signed-off GitHub release from the verified default-branch commit
   and read back its tag, commit, notes, and assets.
9. Verify repository-hosted Claude Code and GitHub Copilot marketplaces with a
   clean install. Cursor Marketplace publication additionally requires its
   publisher application and terms.
10. Publish benchmark results only with the protocol, raw results, limitations,
    model identifiers, repetitions, token usage, and cost accounting.

## Human and account gates

- npm publication requires an authenticated npm account that owns or can create
  the `@autonomous-graph-engineering` scope.
- Cursor Marketplace submission requires the publisher to accept Cursor's
  publisher terms and submit its application.
- Paid benchmark execution requires a finite user-approved cost ceiling.
- Promotion requires an exact authenticated destination. Never infer a social
  account or send a launch message through an unrelated channel.

## Rollback

- A GitHub release can be marked as a prerelease or removed, but a public npm
  version should be treated as immutable. Publish a corrected version instead
  of overwriting it.
- Repository-hosted marketplace entries can be corrected with a new commit and
  version.
- If verification fails after merge but before publication, fix forward through
  a new pull request. Do not rewrite the default branch.
