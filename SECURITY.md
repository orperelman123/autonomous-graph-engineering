# Security policy

## Supported versions

Security fixes are applied to the latest release and the default branch.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting feature for this repository. Include:

- affected version or commit;
- impact and attacker prerequisites;
- a minimal reproduction;
- whether the issue can cause permission expansion, gate bypass, side-effect replay, credential exposure, or audit corruption;
- any suggested mitigation.

Do not include real credentials, private prompts, or customer data.

Please allow maintainers a reasonable period to investigate before public disclosure. We will acknowledge a valid report, assess severity, prepare a fix and regression test, and coordinate disclosure when appropriate.

## High-priority classes

- Permission or autonomy escalation
- Human-gate or reconciliation bypass
- Automatic replay of ambiguous side effects
- Checkpoint fingerprint or audit-integrity bypass
- Command injection or sandbox escape
- Credential leakage in prompts, logs, checkpoints, or errors
- Unauthenticated non-loopback execution
- Budget or output-limit bypass

## Security model and known limits

Be aware of what the built-in controls do and do not guarantee:

- **Human gates bind content, not identity.** An approval token is derived
  deterministically from the graph ID, the graph fingerprint, and the gate ID.
  It proves *what* was approved and detects graph tampering, but it contains no
  secret: any process that can read the graph and invoke the CLI can compute
  the token, and an approval remains valid for every future run of the same
  graph. Treat gate approval as a workflow checkpoint, not as authentication.
  Keep the CLI and graph files out of reach of the agents being orchestrated,
  and rely on executor sandboxing for containment.
- **Gate insertion is heuristic.** The planner classifies destructive or
  external intent with keyword matching. Phrasings outside the keyword list can
  plan as `write`-permission work without a gate. Review generated graphs
  before running them with `workspace` or `consequential` autonomy.
- **Token budgets bound self-reported usage.** Enforcement uses the usage that
  executors report after each execution; an executor that reports nothing
  consumes no budget. Time, node, fan-out, depth, parallelism, and repair
  budgets are enforced by the runtime itself.
- **Checkpoints and audit logs are unsigned local files.** The runtime
  recomputes the graph fingerprint on resume and refuses tampered graphs and
  malformed checkpoints, but it cannot detect a consistent rewrite of the whole
  checkpoint by an actor with write access to the audit directory. Protect the
  audit directory with filesystem permissions.
- **HTTP execution requires a key.** `POST /v1/graphs/run` refuses to execute
  without a configured `GRAPH_ENGINEER_API_KEY`, browser-originated requests
  are rejected, and gate approvals over HTTP additionally require
  `GRAPH_ENGINEER_ALLOW_HTTP_APPROVALS=1`.

## Deployment responsibility

This project is provided without warranty. Operators remain responsible for provider accounts, host hardening, network policy, TLS, secret management, workspace isolation, and review of consequential actions.
