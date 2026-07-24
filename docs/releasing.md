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

## npm trusted publishing

Future npm releases use the manually dispatched
`.github/workflows/npm-publish.yml` workflow. It uses GitHub-hosted runners,
Node 24, npm 11.18.0, `contents: read`, and `id-token: write`; it contains no
registry token. The job checks out an existing stable release tag, proves that
the tag commit is on `main`, verifies every synchronized version and exact
workspace dependency, rebuilds and tests from `npm ci`, then publishes
`prompt-refiner` before `graph-engineer`.

The workflow is safe to retry after a partial release. Before each publish it
packs the local artifact and compares its integrity with the registry. An
identical existing version is skipped; a different integrity or a registry
error fails closed. Each successful publish is read back and compared again.
Trusted publishing automatically creates npm provenance, and the workflow also
requests provenance explicitly.

Trusted publishing cannot bootstrap a package that does not yet exist on npm.
The current packages must therefore be created once by an authenticated owner:

```bash
npm login
npm ci
npm run check
npm publish --workspace @autonomous-graph-engineering/prompt-refiner --access public
npm publish --workspace @autonomous-graph-engineering/graph-engineer --access public
```

Read both versions back, then configure a trusted publisher separately for
each package in npm package settings:

- provider: GitHub Actions;
- GitHub owner: `orperelman123`;
- repository: `autonomous-graph-engineering`;
- workflow filename: `npm-publish.yml`;
- environment: `npm`;
- allowed action: `npm publish`.

The package, npm account with two-factor authentication, and publisher
relationship must already exist before the equivalent npm CLI trust command
can be used. In GitHub, create an `npm` environment with required reviewers and
deployment restrictions. Once both package relationships exist, dispatch
`Publish npm` with an already verified tag such as `v0.3.2`. Do not dispatch it
for a version whose source tag has not passed the complete release gates.

Authoritative references: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/),
[npm publish](https://docs.npmjs.com/cli/publish/), and
[GitHub OIDC permissions](https://docs.github.com/en/actions/reference/security/oidc).

## Human and account gates

- npm publication requires an authenticated npm account that owns or can create
  the `@autonomous-graph-engineering` scope. The first publication is also the
  bootstrap required before npm can accept a trusted-publisher configuration.
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
