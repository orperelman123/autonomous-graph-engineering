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

## Deployment responsibility

This project is provided without warranty. Operators remain responsible for provider accounts, host hardening, network policy, TLS, secret management, workspace isolation, and review of consequential actions.
