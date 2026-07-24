# External security provider

Graph Engineer can place a private, organization-controlled authorization
provider in front of every agent executor. The provider is optional; when it
is configured, an unavailable provider, malformed response, `hold`, or `block`
decision prevents executor invocation.

Set `GRAPH_ENGINEER_SECURITY_PROVIDER_MODULE` to an absolute path to a trusted
ES module outside this repository. The module must export:

```js
export async function createGraphSecurityProvider() {
  return {
    async authorize(request) {
      return { decision: "allow" }; // "allow", "hold", or "block"
    },
  };
}
```

The module is trusted code and runs with the Graph Engineer process's
privileges. Install it from an authenticated private source, pin it to an
immutable revision, review it independently, and keep its credentials outside
plugin manifests and repository files.

## Data boundary

The authorization request contains:

- protocol version, run ID, node ID, executor name, and declared permission;
- SHA-256 hashes of the prompt and node input;
- a SHA-256 hash of the idempotency key when one exists;
- the node timeout and cancellation signal.

It does not contain the raw prompt, node input, working-directory path, or
idempotency key. Provider diagnostics and policy reasoning are not copied into
graph errors or audit events.

## Failure behavior

- No module configured: normal Graph Engineer behavior.
- Relative module path: deny execution.
- Import, initialization, timeout, or provider error: deny execution.
- Unknown decision: deny execution.
- `hold` or `block`: deny execution before the wrapped executor starts.
- `allow`: invoke the wrapped executor unchanged.

Use a synthetic provider in development and verify both allow and deny paths
before connecting a production policy engine. Never place private provider
source, tokens, endpoints, or local absolute paths in the public plugin
package.

## Native Atbash SDK

Graph Engineer optionally depends on the official `@atbash/sdk` package,
pinned to an exact reviewed version. The SDK remains a separate proprietary
dependency; its implementation is not copied into or republished by this
MIT-licensed project.

Enable it explicitly:

```bash
export GRAPH_ENGINEER_SECURITY_PROVIDER=atbash
```

For the transactionally installed local bundle, install the SDK without
activating it:

```bash
npm run install:local -- --with-atbash
npm run verify:install -- --expect-atbash
```

After the agent is onboarded and its key and organization are available through
the official SDK configuration, reinstall with explicit activation:

```bash
npm run install:local -- --with-atbash --enable-atbash
```

The installer uses the exact SDK version declared by Graph Engineer, disables
dependency lifecycle scripts, stages the result transactionally, and does not
write Atbash credentials into the generated MCP manifests.

Configure the official SDK through its supported environment or user config.
At minimum, provide the locally held agent key and onboarded organization:

```bash
export ATBASH_AGENT_KEY="replace-with-process-secret"
export ATBASH_ORG_NAME="onboarded-organization"
```

Optional official SDK settings include `ATBASH_ENDPOINT`,
`ATBASH_BLOCKCHAIN_RID`, `ATBASH_PROVIDER`, and
`ATBASH_PROVIDER_MODEL`. Never write these values into a plugin manifest.

The integration calls the SDK's high-level `auditToolCall()` API with
`failClosed: true`. It respects the SDK's final `allow` decision, maps a denied
`HOLD` to a held graph execution, and maps denied `BLOCK`, `ERROR`, missing
configuration, unavailable SDK, and unrecognized responses to a blocked
execution. Put the Atbash organization into enforcement mode when policy
verdicts must actively stop actions; monitor mode can intentionally return an
allow decision while recording a non-allow verdict.
