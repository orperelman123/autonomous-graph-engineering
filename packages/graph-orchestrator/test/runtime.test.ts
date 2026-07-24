import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CodexCliExecutor,
  LocalEchoExecutor,
  parseClaudeEnvelope,
  parseCodexJsonl,
} from "../src/executors.js";
import { gradeCheckpoint } from "../src/grader.js";
import { loadCheckpoint } from "../src/persistence.js";
import { planGraph } from "../src/planner.js";
import {
  reconcileCheckpoint,
  reconciliationNeeds,
} from "../src/reconciliation.js";
import {
  graphApprovalToken,
  graphFingerprint,
  runGraph,
} from "../src/runtime.js";
import { gradeSemanticCheckpoint } from "../src/semantic-grader.js";
import type {
  AgentExecutionRequest,
  AgentExecutionResult,
  GraphExecutor,
  GraphRunCheckpoint,
} from "../src/types.js";

test("executes a read-only graph and writes a replayable JSONL audit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "graph-runtime-"));
  try {
    const graph = planGraph({
      prompt: "Audit every service in parallel, compare results, and verify findings.",
      autonomy: "read_only",
      primaryExecutor: "local",
      verifierExecutor: "local",
      forceGraph: true,
    });
    const result = await runGraph(graph, {
      executors: { local: new LocalEchoExecutor() },
      auditDirectory: directory,
    });

    assert.equal(result.status, "completed");
    assert.ok(result.auditPath);
    const events = (await readFile(result.auditPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string });
    assert.equal(events[0]?.type, "run_started");
    assert.equal(events.at(-1)?.type, "run_completed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("stops at a human gate until the exact gate is approved", async () => {
  const directory = await mkdtemp(join(tmpdir(), "graph-gate-"));
  try {
    const graph = planGraph({
      prompt: "Deploy the approved application to production.",
      autonomy: "consequential",
      primaryExecutor: "local",
      verifierExecutor: "local",
    });
    const gate = graph.nodes.find((node) => node.kind === "human_gate");
    assert.ok(gate);

    const blocked = await runGraph(graph, {
      executors: { local: new LocalEchoExecutor() },
      auditDirectory: directory,
    });
    assert.equal(blocked.status, "needs_confirmation");
    assert.equal(
      blocked.confirmation?.approvalToken,
      graphApprovalToken(graph, gate.id),
    );

    const approved = await runGraph(graph, {
      executors: { local: new LocalEchoExecutor() },
      approvals: [graphApprovalToken(graph, gate.id)],
      auditDirectory: directory,
    });
    assert.equal(approved.status, "completed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("plan-only never invokes an executor", async () => {
  const graph = planGraph({
    prompt: "Audit every service.",
    autonomy: "plan_only",
    forceGraph: true,
  });
  const result = await runGraph(graph, { executors: {} });

  assert.equal(result.status, "plan_only");
  assert.deepEqual(result.outputs, {});
});

test("propagates the graph goal through execution and reports exhausted repair rounds", async () => {
  const requests: AgentExecutionRequest[] = [];
  class RejectingExecutor implements GraphExecutor {
    readonly name = "rejecting";

    async execute(
      request: AgentExecutionRequest,
    ): Promise<AgentExecutionResult> {
      requests.push(request);
      if (/accepted:boolean|Evaluate the final|Verify the candidate/i.test(request.prompt)) {
        return { output: { accepted: false, reasons: ["not yet"] } };
      }
      return { output: { candidate: true } };
    }
  }

  const graph = planGraph({
    prompt: "Explain this package without changing files.",
    autonomy: "read_only",
    primaryExecutor: "local",
    verifierExecutor: "local",
  });
  const directory = await mkdtemp(join(tmpdir(), "graph-repair-"));
  try {
    const result = await runGraph(graph, {
      executors: { local: new RejectingExecutor() },
      auditDirectory: directory,
    });

    assert.equal(result.status, "failed");
    assert.equal(result.repairRounds, graph.budgets.maxRepairRounds);
    assert.ok(
      requests.every(
        (request) =>
          typeof request.input === "object" &&
          request.input !== null &&
          (request.input as { goal?: string }).goal === graph.goal,
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects executor output that violates a declared schema", async () => {
  class InvalidVerifier implements GraphExecutor {
    readonly name = "invalid-verifier";

    async execute(
      request: AgentExecutionRequest,
    ): Promise<AgentExecutionResult> {
      if (/accepted:boolean|Verify the candidate/i.test(request.prompt)) {
        return { output: { accepted: "yes", reasons: [] } };
      }
      return { output: { candidate: true } };
    }
  }

  const graph = planGraph({
    prompt: "Explain this package without changing files.",
    autonomy: "read_only",
    primaryExecutor: "local",
    verifierExecutor: "local",
  });
  const directory = await mkdtemp(join(tmpdir(), "graph-schema-"));
  try {
    const result = await runGraph(graph, {
      executors: { local: new InvalidVerifier() },
      auditDirectory: directory,
    });

    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /output schema violation/);
    assert.equal(result.nodes.verify?.state, "failed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("enforces declared schemas on deterministic nodes", async () => {
  const graph = planGraph({
    prompt: "Explain this package without changing files.",
    autonomy: "read_only",
    primaryExecutor: "local",
  });
  const execute = graph.nodes.find((node) => node.id === "execute");
  assert.ok(execute);
  execute.kind = "deterministic";
  execute.permission = "none";
  delete execute.executor;
  execute.operation = "identity";
  execute.outputSchema = {
    type: "object",
    required: ["value"],
    properties: { value: { type: "string" } },
  };
  const directory = await mkdtemp(join(tmpdir(), "graph-schema-deterministic-"));
  try {
    const result = await runGraph(graph, {
      executors: { local: new LocalEchoExecutor() },
      auditDirectory: directory,
    });

    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /output schema violation/);
    assert.equal(result.nodes.execute?.state, "failed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("enforces the candidate schema after repair", async () => {
  class InvalidRepairExecutor implements GraphExecutor {
    readonly name = "invalid-repair";

    async execute(
      request: AgentExecutionRequest,
    ): Promise<AgentExecutionResult> {
      if (request.nodeId === "execute") {
        return { output: { value: "valid" } };
      }
      if (request.nodeId.startsWith("repair:")) {
        return { output: { value: 42 } };
      }
      return { output: { accepted: false, reasons: ["repair required"] } };
    }
  }

  const graph = planGraph({
    prompt: "Explain this package without changing files.",
    autonomy: "read_only",
    primaryExecutor: "local",
    verifierExecutor: "local",
  });
  const execute = graph.nodes.find((node) => node.id === "execute");
  assert.ok(execute);
  execute.outputSchema = {
    type: "object",
    required: ["value"],
    properties: { value: { type: "string" } },
  };
  const directory = await mkdtemp(join(tmpdir(), "graph-repair-schema-"));
  try {
    const result = await runGraph(graph, {
      executors: { local: new InvalidRepairExecutor() },
      auditDirectory: directory,
    });

    assert.equal(result.status, "failed");
    assert.equal(result.repairRounds, 1);
    assert.match(result.error ?? "", /output schema violation/);
    assert.deepEqual(result.nodes.execute?.output, { value: "valid" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("timeout terminates the complete executor process tree", async () => {
  const directory = await mkdtemp(join(tmpdir(), "graph-timeout-"));
  const pidPath = join(directory, "descendant.pid");
  const previousExecutable = process.env.CODEX_EXECUTABLE;
  const previousPidPath = process.env.GRAPH_TEST_CHILD_PID_FILE;
  process.env.CODEX_EXECUTABLE = fileURLToPath(
    new URL("./fixtures/hanging-process.js", import.meta.url),
  );
  process.env.GRAPH_TEST_CHILD_PID_FILE = pidPath;
  try {
    await assert.rejects(
      new CodexCliExecutor().execute({
        runId: "timeout-test",
        nodeId: "hang",
        label: "Hang",
        prompt: "Hang",
        permission: "read",
        input: {},
        cwd: directory,
        timeoutMs: 150,
      }),
      /timed out/,
    );
    const descendantPid = Number(await readFile(pidPath, "utf8"));
    let alive = true;
    for (let attempt = 0; attempt < 20 && alive; attempt += 1) {
      try {
        process.kill(descendantPid, 0);
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch {
        alive = false;
      }
    }
    assert.equal(alive, false, "descendant process survived timeout cleanup");
  } finally {
    if (previousExecutable === undefined) delete process.env.CODEX_EXECUTABLE;
    else process.env.CODEX_EXECUTABLE = previousExecutable;
    if (previousPidPath === undefined) {
      delete process.env.GRAPH_TEST_CHILD_PID_FILE;
    } else {
      process.env.GRAPH_TEST_CHILD_PID_FILE = previousPidPath;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("caps dynamic parallel-map fan-out before invoking workers", async () => {
  const calls: string[] = [];
  class FanoutExecutor implements GraphExecutor {
    readonly name = "fanout";
    async execute(
      request: AgentExecutionRequest,
    ): Promise<AgentExecutionResult> {
      calls.push(request.nodeId);
      return {
        output: {
          items: Array.from({ length: 9 }, (_, index) => ({
            id: `item-${index}`,
            task: `task-${index}`,
          })),
        },
      };
    }
  }
  const graph = planGraph({
    prompt: "Audit every service and verify findings.",
    autonomy: "read_only",
    primaryExecutor: "local",
    verifierExecutor: "local",
    forceGraph: true,
  });
  graph.budgets.maxFanout = 8;
  const directory = await mkdtemp(join(tmpdir(), "graph-fanout-"));
  try {
    const result = await runGraph(graph, {
      executors: { local: new FanoutExecutor() },
      auditDirectory: directory,
    });
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /fan-out 9 exceeds maxFanout 8/);
    assert.deepEqual(calls, ["scope"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("dedupe preserves distinct nested objects", async () => {
  class NestedExecutor implements GraphExecutor {
    readonly name = "nested";
    async execute(
      request: AgentExecutionRequest,
    ): Promise<AgentExecutionResult> {
      if (request.nodeId === "scope") {
        return {
          output: {
            items: [
              { id: "one", task: "one" },
              { id: "two", task: "two" },
            ],
          },
        };
      }
      if (request.nodeId === "investigate:0") {
        return { output: { id: "same", detail: { alpha: 1 } } };
      }
      if (request.nodeId === "investigate:1") {
        return { output: { id: "same", detail: { beta: 2 } } };
      }
      if (/Evaluate the final/i.test(request.prompt)) {
        return { output: { accepted: true, reasons: [] } };
      }
      return { output: { accepted: true, reasons: [] } };
    }
  }
  const graph = planGraph({
    prompt: "Audit every service and verify findings.",
    autonomy: "read_only",
    primaryExecutor: "local",
    verifierExecutor: "local",
    forceGraph: true,
  });
  const directory = await mkdtemp(join(tmpdir(), "graph-dedupe-"));
  try {
    const result = await runGraph(graph, {
      executors: { local: new NestedExecutor() },
      auditDirectory: directory,
    });
    assert.equal(result.status, "completed");
    assert.equal((result.outputs.reduce as unknown[]).length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runtime watchdog aborts a non-cooperative executor", async () => {
  let aborted = false;
  class HangingExecutor implements GraphExecutor {
    readonly name = "hanging";
    async execute(
      request: AgentExecutionRequest,
    ): Promise<AgentExecutionResult> {
      request.signal?.addEventListener("abort", () => {
        aborted = true;
      });
      return await new Promise<AgentExecutionResult>(() => {});
    }
  }
  const graph = planGraph({
    prompt: "Explain this function.",
    autonomy: "read_only",
    primaryExecutor: "local",
  });
  // Leave enough room for checkpoint I/O on slow or synchronized filesystems;
  // the executor itself must start before the watchdog behavior is observable.
  graph.budgets.timeoutMs = 1_000;
  const directory = await mkdtemp(join(tmpdir(), "graph-watchdog-"));
  try {
    const result = await runGraph(graph, {
      executors: { local: new HangingExecutor() },
      auditDirectory: directory,
    });
    assert.equal(result.status, "failed");
    assert.equal(aborted, true);
    assert.match(result.error ?? "", /executor timed out/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("timed-out side-effecting executors require reconciliation", async () => {
  let resolveLateEffect: (() => void) | undefined;
  const lateEffect = new Promise<void>((resolve) => {
    resolveLateEffect = resolve;
  });
  class LateWriteExecutor implements GraphExecutor {
    readonly name = "late-write";
    async execute(
      request: AgentExecutionRequest,
    ): Promise<AgentExecutionResult> {
      if (request.nodeId !== "execute") {
        return { output: { accepted: true, reasons: [] } };
      }
      return await new Promise<AgentExecutionResult>((resolve) => {
        setTimeout(() => {
          resolveLateEffect?.();
          resolve({ output: { applied: true } });
        }, 750);
      });
    }
  }
  const graph = planGraph({
    prompt: "Build the local parser.",
    autonomy: "workspace",
    primaryExecutor: "local",
    verifierExecutor: "local",
  });
  // Leave enough headroom for checkpoint I/O before the executor starts. The
  // executor itself still outlives the graph deadline and resolves late.
  graph.budgets.timeoutMs = 500;
  const directory = await mkdtemp(join(tmpdir(), "graph-late-write-"));
  try {
    const result = await runGraph(graph, {
      executors: { local: new LateWriteExecutor() },
      auditDirectory: directory,
    });
    assert.equal(result.status, "failed");
    const checkpoint = await loadCheckpoint(directory, result.runId);
    const needs = reconciliationNeeds(checkpoint);
    assert.deepEqual(
      needs.map((need) => need.nodeId),
      ["execute"],
    );
    assert.equal(checkpoint.nodes.execute?.failureKind, "timeout");
    assert.equal(needs[0]?.requiresTerminationConfirmation, true);
    assert.match(needs[0]?.idempotencyKey ?? "", /^graph:.*:node:execute$/);
    await assert.rejects(
      reconcileCheckpoint({
        directory,
        runId: result.runId,
        nodeId: "execute",
        token: needs[0]!.token,
        outcome: "not_applied",
        evidence: "No effect is visible, but the executor may still be running.",
      }),
      /requires --termination-json/,
    );
    await assert.rejects(
      reconcileCheckpoint({
        directory,
        runId: result.runId,
        nodeId: "execute",
        token: needs[0]!.token,
        outcome: "not_applied",
        evidence: "The executor process was independently inspected.",
        terminationEvidence: {
          attemptId: "wrong-attempt",
          executor: "local",
          observedAt: new Date().toISOString(),
          method: "process-tree inspection",
          status: "terminated",
        },
      }),
      /must match the timed-out attempt and executor/,
    );
    await lateEffect;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("repair preserves candidate permission and synchronizes final state", async () => {
  const repairPermissions: string[] = [];
  class RepairExecutor implements GraphExecutor {
    readonly name = "repair-state";
    async execute(
      request: AgentExecutionRequest,
    ): Promise<AgentExecutionResult> {
      if (request.nodeId === "execute") return { output: { value: "initial" } };
      if (request.nodeId === "verify") {
        return { output: { accepted: false, reasons: ["repair"] } };
      }
      if (request.nodeId.startsWith("repair:")) {
        repairPermissions.push(request.permission);
        return { output: { value: "repaired" } };
      }
      return { output: { accepted: true, reasons: [] } };
    }
  }
  const graph = planGraph({
    prompt: "Explain this function.",
    autonomy: "workspace",
    primaryExecutor: "local",
    verifierExecutor: "local",
  });
  const execute = graph.nodes.find((node) => node.id === "execute");
  assert.ok(execute);
  execute.permission = "read";
  assert.ok(graph.repairPolicy);
  graph.repairPolicy.enabled = true;
  execute.outputSchema = {
    type: "object",
    required: ["value"],
    properties: { value: { type: "string" } },
  };
  const directory = await mkdtemp(join(tmpdir(), "graph-repair-state-"));
  try {
    const result = await runGraph(graph, {
      executors: { local: new RepairExecutor() },
      auditDirectory: directory,
    });
    assert.equal(result.status, "completed");
    assert.equal(result.repairRounds, 1);
    assert.deepEqual(repairPermissions, ["read"]);
    assert.deepEqual(result.nodes.execute?.output, { value: "repaired" });
    assert.deepEqual(result.nodes.verify?.output, {
      accepted: true,
      reasons: [],
    });
    const events = (await readFile(result.auditPath ?? "", "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; data?: object });
    assert.ok(
      events.some(
        (event) =>
          event.type === "repair_completed" &&
          event.data &&
          "verifierOutput" in event.data,
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fails closed when a consequential result is rejected", async () => {
  let repairCalls = 0;
  class ConsequentialExecutor implements GraphExecutor {
    readonly name = "consequential";
    async execute(
      request: AgentExecutionRequest,
    ): Promise<AgentExecutionResult> {
      if (request.nodeId.startsWith("repair:")) repairCalls += 1;
      if (/Evaluate the final/i.test(request.prompt)) {
        return { output: { accepted: false, reasons: ["not accepted"] } };
      }
      if (/decompose/i.test(request.prompt)) {
        return { output: { items: [{ id: "one", task: "one" }] } };
      }
      return { output: { completed: true } };
    }
  }
  const graph = planGraph({
    prompt:
      "Audit every deployment dependency and deploy the approved application to production.",
    autonomy: "consequential",
    primaryExecutor: "local",
    verifierExecutor: "local",
    forceGraph: true,
  });
  assert.equal(graph.repairPolicy?.enabled, false);
  const directory = await mkdtemp(join(tmpdir(), "graph-consequential-"));
  try {
    const result = await runGraph(graph, {
      executors: { local: new ConsequentialExecutor() },
      approvals: [graphApprovalToken(graph, "confirm")],
      auditDirectory: directory,
    });
    assert.equal(result.status, "failed");
    assert.equal(repairCalls, 0);
    assert.match(result.error ?? "", /acceptance criteria failed/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("limits captured executor output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "graph-output-limit-"));
  const previousExecutable = process.env.CODEX_EXECUTABLE;
  const previousLimit = process.env.GRAPH_ENGINEER_MAX_OUTPUT_BYTES;
  process.env.CODEX_EXECUTABLE = fileURLToPath(
    new URL("./fixtures/noisy-process.js", import.meta.url),
  );
  process.env.GRAPH_ENGINEER_MAX_OUTPUT_BYTES = "1024";
  try {
    await assert.rejects(
      new CodexCliExecutor().execute({
        runId: "output-test",
        nodeId: "noisy",
        label: "Noisy",
        prompt: "Noisy",
        permission: "read",
        input: {},
        cwd: directory,
        timeoutMs: 5_000,
      }),
      /output exceeded 1024 byte limit/,
    );
  } finally {
    if (previousExecutable === undefined) delete process.env.CODEX_EXECUTABLE;
    else process.env.CODEX_EXECUTABLE = previousExecutable;
    if (previousLimit === undefined) {
      delete process.env.GRAPH_ENGINEER_MAX_OUTPUT_BYTES;
    } else {
      process.env.GRAPH_ENGINEER_MAX_OUTPUT_BYTES = previousLimit;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("parses reliable Codex and Claude usage envelopes", () => {
  const codex = parseCodexJsonl(
    [
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: '{"ok":true}' },
      }),
      JSON.stringify({
        type: "turn.completed",
        usage: {
          input_tokens: 100,
          cached_input_tokens: 80,
          output_tokens: 12,
          reasoning_output_tokens: 4,
        },
      }),
    ].join("\n"),
  );
  assert.deepEqual(codex.output, { ok: true });
  assert.deepEqual(codex.usage, {
    inputTokens: 100,
    cachedInputTokens: 80,
    outputTokens: 12,
    reasoningOutputTokens: 4,
  });

  const claude = parseClaudeEnvelope(
    JSON.stringify({
      result: '{"ok":true}',
      total_cost_usd: 0.25,
      usage: {
        input_tokens: 20,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 5,
        output_tokens: 7,
      },
    }),
  );
  assert.deepEqual(claude.output, { ok: true });
  assert.deepEqual(claude.usage, {
    inputTokens: 35,
    cachedInputTokens: 10,
    cacheCreationInputTokens: 5,
    outputTokens: 7,
    costUsd: 0.25,
  });
});

test("stops when actual provider usage exceeds the graph token budget", async () => {
  class OverBudgetExecutor implements GraphExecutor {
    readonly name = "over-budget";
    async execute(): Promise<AgentExecutionResult> {
      return {
        output: { completed: true },
        usage: { inputTokens: 500_001, outputTokens: 1 },
      };
    }
  }
  const graph = planGraph({
    prompt: "Explain this function.",
    primaryExecutor: "local",
    verifierExecutor: "local",
  });
  const directory = await mkdtemp(join(tmpdir(), "graph-token-budget-"));
  try {
    const result = await runGraph(graph, {
      executors: { local: new OverBudgetExecutor() },
      auditDirectory: directory,
    });
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /actual token use 500002 exceeds/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("aggregates executor usage and preserves it across completed resume", async () => {
  class MeteredExecutor implements GraphExecutor {
    readonly name = "metered";
    async execute(
      request: AgentExecutionRequest,
    ): Promise<AgentExecutionResult> {
      return {
        output:
          request.nodeId === "verify"
            ? { accepted: true, reasons: [] }
            : { completed: true },
        usage: {
          inputTokens: 10,
          cachedInputTokens: 3,
          outputTokens: 2,
          costUsd: 0.01,
        },
      };
    }
  }
  const graph = planGraph({
    prompt: "Explain this function.",
    primaryExecutor: "local",
    verifierExecutor: "local",
  });
  const directory = await mkdtemp(join(tmpdir(), "graph-usage-"));
  try {
    const result = await runGraph(graph, {
      executors: { local: new MeteredExecutor() },
      auditDirectory: directory,
    });
    assert.deepEqual(result.usage, {
      inputTokens: 20,
      cachedInputTokens: 6,
      outputTokens: 4,
      costUsd: 0.02,
    });
    const grade = await gradeCheckpoint(directory, result.runId);
    assert.equal(grade.passed, true);
    assert.equal(grade.score, 1);
    const checkpoint = await loadCheckpoint(directory, result.runId);
    const resumed = await runGraph(graph, {
      executors: { local: new MeteredExecutor() },
      auditDirectory: directory,
      resume: checkpoint,
    });
    assert.deepEqual(resumed.usage, result.usage);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("grades repository semantic expectations against accepted output", async () => {
  class SemanticExecutor implements GraphExecutor {
    readonly name = "semantic";
    async execute(
      request: AgentExecutionRequest,
    ): Promise<AgentExecutionResult> {
      if (request.nodeId === "verify") {
        return { output: { accepted: true, reasons: [] } };
      }
      return {
        output:
          "Package autonomous-graph-engineering requires Node >=20.",
      };
    }
  }
  const graph = planGraph({
    prompt: "Report package metadata.",
    primaryExecutor: "local",
    verifierExecutor: "local",
  });
  const directory = await mkdtemp(join(tmpdir(), "graph-semantic-grade-"));
  try {
    const run = await runGraph(graph, {
      executors: { local: new SemanticExecutor() },
      auditDirectory: directory,
    });
    const grade = await gradeSemanticCheckpoint({
      directory,
      runId: run.runId,
      semanticCase: {
        id: "metadata",
        prompt: "Report package metadata.",
        forceGraph: false,
        expectedAll: ["autonomous-graph-engineering", ">=20"],
        forbiddenAny: ["unknown"],
      },
    });
    assert.equal(grade.passed, true);
    assert.equal(grade.score, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runs independent ready DAG nodes concurrently within maxParallel", async () => {
  let active = 0;
  let peak = 0;
  let release: (() => void) | undefined;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  class ConcurrentExecutor implements GraphExecutor {
    readonly name = "concurrent";
    async execute(
      request: AgentExecutionRequest,
    ): Promise<AgentExecutionResult> {
      if (request.nodeId === "verify") {
        return { output: { accepted: true, reasons: [] } };
      }
      active += 1;
      peak = Math.max(peak, active);
      if (active === 2) release?.();
      await barrier;
      active -= 1;
      return { output: { nodeId: request.nodeId } };
    }
  }
  const graph = planGraph({
    prompt: "Explain this function.",
    autonomy: "read_only",
    primaryExecutor: "local",
    verifierExecutor: "local",
  });
  const execute = graph.nodes.find((node) => node.id === "execute");
  const verify = graph.nodes.find((node) => node.id === "verify");
  assert.ok(execute);
  assert.ok(verify);
  graph.nodes.splice(1, 0, {
    ...execute,
    id: "execute_peer",
    label: "Execute peer",
  });
  verify.dependsOn = ["execute", "execute_peer"];
  graph.budgets.maxParallel = 2;
  graph.budgets.timeoutMs = 1_000;
  const directory = await mkdtemp(join(tmpdir(), "graph-dag-concurrency-"));
  try {
    const result = await runGraph(graph, {
      executors: { local: new ConcurrentExecutor() },
      auditDirectory: directory,
    });
    assert.equal(result.status, "completed");
    assert.equal(peak, 2);
  } finally {
    release?.();
    await rm(directory, { recursive: true, force: true });
  }
});

test("enforces maxParallel globally across concurrent map nodes", async () => {
  let active = 0;
  let peak = 0;
  let release: (() => void) | undefined;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  class GloballyLimitedExecutor implements GraphExecutor {
    readonly name = "globally-limited";
    async execute(
      request: AgentExecutionRequest,
    ): Promise<AgentExecutionResult> {
      if (request.nodeId.endsWith("_seed")) {
        return { output: [1, 2, 3] };
      }
      if (request.nodeId === "acceptance") {
        return { output: { accepted: true, reasons: [] } };
      }
      active += 1;
      peak = Math.max(peak, active);
      if (active === 2) release?.();
      await barrier;
      active -= 1;
      return { output: request.input };
    }
  }
  const graph = planGraph({
    prompt: "Compare multiple independent sources and verify them.",
    autonomy: "read_only",
    primaryExecutor: "local",
    verifierExecutor: "local",
    forceGraph: true,
  });
  graph.nodes = [
    {
      id: "left_seed",
      label: "Left seed",
      kind: "agent",
      dependsOn: [],
      permission: "read",
      executor: "local",
    },
    {
      id: "right_seed",
      label: "Right seed",
      kind: "agent",
      dependsOn: [],
      permission: "read",
      executor: "local",
    },
    {
      id: "left_map",
      label: "Left map",
      kind: "parallel_map",
      dependsOn: ["left_seed"],
      permission: "read",
      executor: "local",
      maxConcurrency: 2,
    },
    {
      id: "right_map",
      label: "Right map",
      kind: "parallel_map",
      dependsOn: ["right_seed"],
      permission: "read",
      executor: "local",
      maxConcurrency: 2,
    },
    {
      id: "acceptance",
      label: "Acceptance",
      kind: "verifier",
      dependsOn: ["left_map", "right_map"],
      permission: "read",
      executor: "local",
    },
  ];
  delete graph.repairPolicy;
  graph.budgets.maxParallel = 2;
  graph.budgets.timeoutMs = 1_000;
  const directory = await mkdtemp(join(tmpdir(), "graph-global-concurrency-"));
  try {
    const result = await runGraph(graph, {
      executors: { local: new GloballyLimitedExecutor() },
      auditDirectory: directory,
    });
    assert.equal(result.status, "completed");
    assert.equal(peak, 2);
  } finally {
    release?.();
    await rm(directory, { recursive: true, force: true });
  }
});

test("resumes a gated checkpoint without replaying completed preflight nodes", async () => {
  const calls = new Map<string, number>();
  class ResumeExecutor implements GraphExecutor {
    readonly name = "resume";
    async execute(
      request: AgentExecutionRequest,
    ): Promise<AgentExecutionResult> {
      calls.set(request.nodeId, (calls.get(request.nodeId) ?? 0) + 1);
      if (request.nodeId === "scope") {
        return { output: { items: [{ id: "one", task: "inspect" }] } };
      }
      if (request.nodeId === "acceptance") {
        return { output: { accepted: true, reasons: [] } };
      }
      return { output: { completed: true, nodeId: request.nodeId } };
    }
  }
  const graph = planGraph({
    prompt:
      "Audit every deployment dependency and deploy the approved application to production.",
    autonomy: "consequential",
    primaryExecutor: "local",
    verifierExecutor: "local",
    forceGraph: true,
  });
  const directory = await mkdtemp(join(tmpdir(), "graph-resume-gate-"));
  try {
    const executor = new ResumeExecutor();
    const blocked = await runGraph(graph, {
      executors: { local: executor },
      auditDirectory: directory,
    });
    assert.equal(blocked.status, "needs_confirmation");
    assert.ok(blocked.confirmation);
    const checkpoint = await loadCheckpoint(directory, blocked.runId);

    const resumed = await runGraph(graph, {
      executors: { local: executor },
      auditDirectory: directory,
      approvals: [blocked.confirmation.approvalToken],
      resume: checkpoint,
    });
    assert.equal(resumed.status, "completed");
    assert.equal(resumed.runId, blocked.runId);
    assert.equal(calls.get("scope"), 1);
    assert.equal(calls.get("investigate:0"), 1);
    assert.equal(calls.get("cross_check:0"), 1);
    assert.equal(calls.get("synthesize"), 1);
    assert.equal(calls.get("act"), 1);
    const events = (await readFile(resumed.auditPath!, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { sequence: number; type: string });
    assert.ok(events.some((event) => event.type === "run_resumed"));
    assert.ok(events.every((event, index) => event.sequence === index + 1));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects a forged completed gate in an unfinished checkpoint", async () => {
  let actionCalls = 0;
  class ForgedGateExecutor implements GraphExecutor {
    readonly name = "forged-gate";
    async execute(
      request: AgentExecutionRequest,
    ): Promise<AgentExecutionResult> {
      if (request.nodeId === "scope") {
        return { output: { items: [{ id: "one", task: "inspect" }] } };
      }
      if (request.nodeId === "act") actionCalls += 1;
      if (request.nodeId === "acceptance") {
        return { output: { accepted: true, reasons: [] } };
      }
      return { output: { completed: true } };
    }
  }
  const graph = planGraph({
    prompt:
      "Audit every deployment dependency and deploy the approved application to production.",
    autonomy: "consequential",
    primaryExecutor: "local",
    verifierExecutor: "local",
    forceGraph: true,
  });
  const gate = graph.nodes.find((node) => node.kind === "human_gate");
  assert.ok(gate);
  const directory = await mkdtemp(join(tmpdir(), "graph-forged-gate-"));
  try {
    const executor = new ForgedGateExecutor();
    const blocked = await runGraph(graph, {
      executors: { local: executor },
      auditDirectory: directory,
    });
    assert.equal(blocked.status, "needs_confirmation");
    const checkpoint = await loadCheckpoint(directory, blocked.runId);
    const approvalToken = graphApprovalToken(graph, gate.id);
    checkpoint.status = "running";
    checkpoint.nodes[gate.id] = {
      nodeId: gate.id,
      state: "completed",
      output: { approved: true, gateId: gate.id, approvalToken },
    };
    checkpoint.outputs[gate.id] = {
      approved: true,
      gateId: gate.id,
      approvalToken,
    };

    await assert.rejects(
      runGraph(graph, {
        executors: { local: executor },
        auditDirectory: directory,
        resume: checkpoint,
      }),
      /completed gate confirm requires its approval token again/,
    );
    assert.equal(actionCalls, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects a checkpoint whose graph was changed", async () => {
  const graph = planGraph({
    prompt: "Explain this function.",
    primaryExecutor: "local",
    verifierExecutor: "local",
  });
  const directory = await mkdtemp(join(tmpdir(), "graph-resume-tamper-"));
  try {
    const completed = await runGraph(graph, {
      executors: { local: new LocalEchoExecutor() },
      auditDirectory: directory,
    });
    const checkpoint = await loadCheckpoint(directory, completed.runId);
    checkpoint.graph.goal = "tampered goal";
    await assert.rejects(
      runGraph(checkpoint.graph, {
        executors: { local: new LocalEchoExecutor() },
        auditDirectory: directory,
        resume: checkpoint,
      }),
      /checkpoint graph fingerprint mismatch/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("refuses automatic replay of an interrupted write node", async () => {
  const graph = planGraph({
    prompt: "Implement this focused change.",
    autonomy: "workspace",
    primaryExecutor: "local",
    verifierExecutor: "local",
  });
  const now = new Date().toISOString();
  const checkpoint: GraphRunCheckpoint = {
    version: "1.0",
    graph,
    graphHash: graphFingerprint(graph),
    runId: "uncertain-write",
    status: "running",
    outputs: {},
    nodes: {
      execute: { nodeId: "execute", state: "running", startedAt: now },
      verify: { nodeId: "verify", state: "pending" },
    },
    repairRounds: 0,
    usage: {},
    startedAt: now,
    updatedAt: now,
    eventSequence: 1,
  };

  await assert.rejects(
    runGraph(graph, {
      executors: { local: new LocalEchoExecutor() },
      resume: checkpoint,
    }),
    /cannot automatically resume uncertain side-effecting node execute/,
  );
});

test("requires fingerprint-bound reconciliation before retrying an ambiguous write", async () => {
  let executeCalls = 0;
  const idempotencyKeys: Array<string | undefined> = [];
  const attemptIds: Array<string | undefined> = [];
  class RetryExecutor implements GraphExecutor {
    readonly name = "retry";
    async execute(
      request: AgentExecutionRequest,
    ): Promise<AgentExecutionResult> {
      if (request.nodeId === "execute") {
        executeCalls += 1;
        idempotencyKeys.push(request.idempotencyKey);
        attemptIds.push(request.attemptId);
        if (executeCalls === 1) throw new Error("simulated process loss");
        return { output: { applied: true } };
      }
      return { output: { accepted: true, reasons: [] } };
    }
  }
  const graph = planGraph({
    prompt: "Implement this focused change.",
    autonomy: "workspace",
    primaryExecutor: "local",
    verifierExecutor: "local",
  });
  const directory = await mkdtemp(join(tmpdir(), "graph-reconcile-retry-"));
  try {
    const executor = new RetryExecutor();
    const failed = await runGraph(graph, {
      executors: { local: executor },
      auditDirectory: directory,
    });
    assert.equal(failed.status, "failed");
    const checkpoint = await loadCheckpoint(directory, failed.runId);
    const [need] = reconciliationNeeds(checkpoint);
    assert.ok(need);
    await assert.rejects(
      reconcileCheckpoint({
        directory,
        runId: failed.runId,
        nodeId: "execute",
        token: "wrong-token",
        outcome: "not_applied",
        evidence: "Verified the simulated write did not apply.",
      }),
      /reconciliation token mismatch/,
    );
    const reconciled = await reconcileCheckpoint({
      directory,
      runId: failed.runId,
      nodeId: "execute",
      token: need.token,
      outcome: "not_applied",
      evidence: "Verified the simulated write did not apply.",
    });
    const resumed = await runGraph(graph, {
      executors: { local: executor },
      auditDirectory: directory,
      resume: reconciled,
    });
    assert.equal(resumed.status, "completed");
    assert.equal(executeCalls, 2);
    assert.equal(idempotencyKeys.length, 2);
    assert.equal(idempotencyKeys[0], idempotencyKeys[1]);
    assert.match(idempotencyKeys[0] ?? "", /^graph:.*:node:execute$/);
    assert.notEqual(attemptIds[0], attemptIds[1]);
    assert.equal(resumed.nodes.execute?.state, "completed");
    const events = (await readFile(resumed.auditPath!, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { sequence: number; type: string });
    assert.ok(events.some((event) => event.type === "node_reconciled"));
    assert.ok(events.every((event, index) => event.sequence === index + 1));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("accepts operator-verified output without replaying an ambiguous write", async () => {
  let executeCalls = 0;
  class CompletedExecutor implements GraphExecutor {
    readonly name = "completed";
    async execute(
      request: AgentExecutionRequest,
    ): Promise<AgentExecutionResult> {
      if (request.nodeId === "execute") {
        executeCalls += 1;
        throw new Error("simulated lost acknowledgement");
      }
      return { output: { accepted: true, reasons: [] } };
    }
  }
  const graph = planGraph({
    prompt: "Implement this focused change.",
    autonomy: "workspace",
    primaryExecutor: "local",
    verifierExecutor: "local",
  });
  const directory = await mkdtemp(join(tmpdir(), "graph-reconcile-complete-"));
  try {
    const executor = new CompletedExecutor();
    const failed = await runGraph(graph, {
      executors: { local: executor },
      auditDirectory: directory,
    });
    const checkpoint = await loadCheckpoint(directory, failed.runId);
    const [need] = reconciliationNeeds(checkpoint);
    assert.ok(need);
    const reconciled = await reconcileCheckpoint({
      directory,
      runId: failed.runId,
      nodeId: "execute",
      token: need.token,
      outcome: "completed",
      evidence: "Verified the simulated target contains the intended result.",
      output: { applied: true, externallyVerified: true },
    });
    const resumed = await runGraph(graph, {
      executors: { local: executor },
      auditDirectory: directory,
      resume: reconciled,
    });
    assert.equal(resumed.status, "completed");
    assert.equal(executeCalls, 1);
    assert.deepEqual(resumed.outputs.execute, {
      applied: true,
      externallyVerified: true,
    });
    assert.equal(resumed.repairRounds, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects operator-verified output that violates the node schema", async () => {
  class SchemaExecutor implements GraphExecutor {
    readonly name = "schema-reconciliation";
    async execute(
      request: AgentExecutionRequest,
    ): Promise<AgentExecutionResult> {
      if (request.nodeId === "execute") {
        throw new Error("simulated lost acknowledgement");
      }
      return { output: { accepted: true, reasons: [] } };
    }
  }
  const graph = planGraph({
    prompt: "Implement this focused change.",
    autonomy: "workspace",
    primaryExecutor: "local",
    verifierExecutor: "local",
  });
  const execute = graph.nodes.find((node) => node.id === "execute");
  assert.ok(execute);
  execute.outputSchema = {
    type: "object",
    required: ["applied"],
    properties: { applied: { type: "boolean" } },
    additionalProperties: false,
  };
  const directory = await mkdtemp(join(tmpdir(), "graph-reconcile-schema-"));
  try {
    const failed = await runGraph(graph, {
      executors: { local: new SchemaExecutor() },
      auditDirectory: directory,
    });
    const before = await loadCheckpoint(directory, failed.runId);
    const [need] = reconciliationNeeds(before);
    assert.ok(need);
    await assert.rejects(
      reconcileCheckpoint({
        directory,
        runId: failed.runId,
        nodeId: "execute",
        token: need.token,
        outcome: "completed",
        evidence: "Verified the target independently.",
        output: { applied: "yes" },
      }),
      /output schema violation/,
    );
    const after = await loadCheckpoint(directory, failed.runId);
    assert.deepEqual(after, before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

