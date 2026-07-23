# Security model

## Protected assets

- The exact user request and negative constraints
- Workspace files and version-control state
- External systems reachable by model tools
- Provider credentials and local configuration
- Human approvals and reconciliation attestations
- Audit and checkpoint integrity
- Token and cost budgets

## Trust boundaries

Trusted deterministic code includes the compiler, planner, validator, scheduler, persistence layer, graders, and CLI gate handling. Model responses, subprocess stdout, graph inputs received over HTTP, and files read from a mutable workspace are untrusted.

## Controls

### Intent and permission preservation

- The original prompt is retained and hashed.
- Refinement cannot add permissions.
- Node permission must not exceed graph autonomy.
- Human gates cannot elevate autonomy.

### Consequential actions

- External and destructive nodes require a gate ancestor.
- Side-effecting pre-gate ancestors are rejected.
- Approval tokens bind the full graph fingerprint.
- MCP cannot supply approvals.
- HTTP approval requires an API key plus `GRAPH_ENGINEER_ALLOW_HTTP_APPROVALS=1`.
- An unfinished checkpoint cannot carry a completed human gate across resume
  unless the trusted caller supplies the exact graph-bound approval again.

### Execution isolation

- Read nodes use read-only or plan modes.
- Write nodes use workspace-scoped modes.
- Concurrent writes are rejected because worktree isolation is not yet enforced.
- Process output, wall time, repair rounds, fan-out, concurrency, and tokens are capped.
- Complete subprocess trees are terminated on abort or timeout.

### Recovery

- Checkpoints are written through a temporary file and atomic rename.
- Completed nodes are not replayed during resume.
- Ambiguous side-effecting nodes fail closed.
- Reconciliation tokens bind the run, graph fingerprint, and node.
- Reconciliation requires explicit evidence and is recorded in the audit.

### HTTP

- Default bind is `127.0.0.1`.
- Non-loopback bind requires `GRAPH_ENGINEER_API_KEY`.
- `/v1/` uses bearer authentication with constant-time comparison.
- Request bodies are limited to 2 MB.
- Responses disable caching.

## Threats not fully solved

- A malicious local administrator can modify code, checkpoints, credentials, or audit files.
- Bearer authentication does not provide TLS, rate limiting, identity federation, or authorization roles.
- Workspace-write subprocesses can modify any file permitted by the underlying sandbox.
- Model verification can be wrong or collusive; semantic correctness still requires domain-specific evaluation.
- Provider CLI output contracts may change.
- Checkpoint atomicity does not make JSONL and checkpoint writes one transactional unit.

## Deployment guidance

- Keep the HTTP service on loopback unless a reverse proxy provides TLS, authentication policy, rate limiting, and network restrictions.
- Use dedicated low-privilege provider accounts.
- Run write workflows in disposable branches or isolated worktrees managed outside this runtime.
- Protect `.graph-runs` as sensitive operational evidence.
- Never place credentials in prompts, graphs, checkpoint evidence, or repository files.
- Review every consequential graph and its fingerprint-bound token before approval.

For vulnerability reporting, follow [SECURITY.md](../SECURITY.md).
