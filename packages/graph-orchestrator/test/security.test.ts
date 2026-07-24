import assert from "node:assert/strict";
import test from "node:test";
import {
  AtbashSecurityProvider,
  defaultExecutors,
  SecurityGatedExecutor,
  securityProviderFromEnvironment,
  type GraphSecurityProvider,
  type SecurityAuthorizationRequest,
} from "../src/security.js";
import type {
  AgentExecutionRequest,
  GraphExecutor,
} from "../src/types.js";

function request(): AgentExecutionRequest {
  return {
    runId: "run-1",
    nodeId: "execute",
    label: "private label",
    prompt: "PRIVATE-PROMPT",
    permission: "external",
    input: { secret: "PRIVATE-INPUT" },
    idempotencyKey: "PRIVATE-IDEMPOTENCY-KEY",
    cwd: "C:\\PRIVATE\\WORKSPACE",
    timeoutMs: 5_000,
  };
}

class Delegate implements GraphExecutor {
  readonly name = "delegate";
  calls = 0;

  async execute() {
    this.calls += 1;
    return { output: { completed: true } };
  }
}

test("security gate sends hashes instead of private executor inputs", async () => {
  const delegate = new Delegate();
  let captured: SecurityAuthorizationRequest | undefined;
  const provider: GraphSecurityProvider = {
    async authorize(value) {
      captured = value;
      return { decision: "allow" };
    },
  };
  const result = await new SecurityGatedExecutor(delegate, provider).execute(
    request(),
  );
  assert.deepEqual(result.output, { completed: true });
  assert.equal(delegate.calls, 1);
  assert.equal(captured?.version, "1");
  assert.equal(captured?.permission, "external");
  assert.match(captured?.promptSha256 ?? "", /^[a-f0-9]{64}$/);
  assert.match(captured?.inputSha256 ?? "", /^[a-f0-9]{64}$/);
  assert.match(captured?.idempotencyKeySha256 ?? "", /^[a-f0-9]{64}$/);
  const serialized = JSON.stringify(captured);
  for (const privateValue of [
    "PRIVATE-PROMPT",
    "PRIVATE-INPUT",
    "PRIVATE-IDEMPOTENCY-KEY",
    "PRIVATE",
  ]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test("security gate prevents delegation for hold and block decisions", async () => {
  for (const decision of ["hold", "block"] as const) {
    const delegate = new Delegate();
    const gated = new SecurityGatedExecutor(delegate, {
      async authorize() {
        return { decision };
      },
    });
    await assert.rejects(
      gated.execute(request()),
      decision === "hold" ? /held/ : /blocked/,
    );
    assert.equal(delegate.calls, 0);
  }
});

test("security gate fails closed without exposing provider errors", async () => {
  const delegate = new Delegate();
  const gated = new SecurityGatedExecutor(delegate, {
    async authorize() {
      throw new Error("PRIVATE-PROVIDER-DIAGNOSTIC");
    },
  });
  await assert.rejects(
    gated.execute(request()),
    /external security provider unavailable; execution denied/,
  );
  assert.equal(delegate.calls, 0);
});

test("security gate bounds a non-settling provider by the execution deadline", async () => {
  const delegate = new Delegate();
  const gated = new SecurityGatedExecutor(delegate, {
    async authorize() {
      return await new Promise(() => undefined);
    },
  });
  const boundedRequest = request();
  boundedRequest.timeoutMs = 25;
  const startedAt = Date.now();
  await assert.rejects(
    gated.execute(boundedRequest),
    /external security provider unavailable; execution denied/,
  );
  assert.ok(Date.now() - startedAt < 1_000);
  assert.equal(delegate.calls, 0);
});

test("security gate rejects malformed provider decisions", async () => {
  const delegate = new Delegate();
  const provider = {
    async authorize() {
      return { decision: "maybe" };
    },
  } as unknown as GraphSecurityProvider;
  await assert.rejects(
    new SecurityGatedExecutor(delegate, provider).execute(request()),
    /invalid decision/,
  );
  assert.equal(delegate.calls, 0);
});

test("security provider is opt-in and a relative module path fails closed", async () => {
  assert.equal(securityProviderFromEnvironment({}), undefined);
  const provider = securityProviderFromEnvironment({
    GRAPH_ENGINEER_SECURITY_PROVIDER_MODULE: "./private-provider.js",
  });
  assert.ok(provider);
  await assert.rejects(
    provider.authorize({
      version: "1",
      runId: "run",
      nodeId: "node",
      executor: "local",
      permission: "read",
      promptSha256: "a".repeat(64),
      inputSha256: "b".repeat(64),
      timeoutMs: 1_000,
    }),
    /absolute/,
  );
  assert.equal(defaultExecutors({}).local instanceof SecurityGatedExecutor, false);
});

test("native Atbash provider uses the official SDK decision contract", async () => {
  const calls: unknown[] = [];
  const provider = new AtbashSecurityProvider({
    async auditToolCall(input) {
      calls.push(input);
      return { allow: false, verdict: "HOLD" };
    },
  });
  const decision = await provider.authorize({
    version: "1",
    runId: "run-1",
    nodeId: "execute",
    executor: "codex",
    permission: "write",
    promptSha256: "a".repeat(64),
    inputSha256: "b".repeat(64),
    idempotencyKeySha256: "c".repeat(64),
    timeoutMs: 1_000,
  });
  assert.deepEqual(decision, { decision: "hold" });
  assert.deepEqual(calls, [
    {
      toolName: "graph-engineer.codex",
      args: {
        protocolVersion: "1",
        runId: "run-1",
        nodeId: "execute",
        permission: "write",
        promptSha256: "a".repeat(64),
        inputSha256: "b".repeat(64),
        idempotencyKeySha256: "c".repeat(64),
      },
      context: "Graph Engineer executor authorization",
    },
  ]);
});

test("native Atbash provider denies error and unknown verdicts", async () => {
  for (const verdict of ["ERROR", "No verdict"]) {
    const provider = new AtbashSecurityProvider({
      async auditToolCall() {
        return { allow: false, verdict };
      },
    });
    assert.deepEqual(
      await provider.authorize({
        version: "1",
        runId: "run",
        nodeId: "node",
        executor: "local",
        permission: "read",
        promptSha256: "a".repeat(64),
        inputSha256: "b".repeat(64),
        timeoutMs: 1_000,
      }),
      { decision: "block" },
    );
  }
});

test("native Atbash provider respects the SDK allow decision in monitor mode", async () => {
  const provider = new AtbashSecurityProvider({
    async auditToolCall() {
      return { allow: true, verdict: "BLOCK" };
    },
  });
  assert.deepEqual(
    await provider.authorize({
      version: "1",
      runId: "run",
      nodeId: "node",
      executor: "local",
      permission: "read",
      promptSha256: "a".repeat(64),
      inputSha256: "b".repeat(64),
      timeoutMs: 1_000,
    }),
    { decision: "allow" },
  );
});

test("Atbash activation is explicit and conflicting providers fail closed", async () => {
  assert.ok(
    securityProviderFromEnvironment({
      GRAPH_ENGINEER_SECURITY_PROVIDER: "atbash",
    }),
  );
  const conflict = securityProviderFromEnvironment({
    GRAPH_ENGINEER_SECURITY_PROVIDER: "atbash",
    GRAPH_ENGINEER_SECURITY_PROVIDER_MODULE: "C:\\provider.mjs",
  });
  assert.ok(conflict);
  await assert.rejects(
    conflict.authorize({
      version: "1",
      runId: "run",
      nodeId: "node",
      executor: "local",
      permission: "read",
      promptSha256: "a".repeat(64),
      inputSha256: "b".repeat(64),
      timeoutMs: 1_000,
    }),
    /multiple/,
  );
});
