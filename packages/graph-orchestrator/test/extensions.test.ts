import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  GraphExtensionRegistry,
  runExtensionGraders,
} from "../src/extensions.js";
import { gradeCheckpoint } from "../src/grader.js";
import { planGraph } from "../src/planner.js";
import { runGraph } from "../src/runtime.js";
import type {
  AgentExecutionRequest,
  AgentExecutionResult,
  GraphExecutor,
  GraphRunCheckpoint,
} from "../src/types.js";
import { validateGraph } from "../src/validator.js";

class FixtureExecutor implements GraphExecutor {
  readonly name = "fixture-executor";
  calls = 0;

  async execute(
    request: AgentExecutionRequest,
  ): Promise<AgentExecutionResult> {
    this.calls += 1;
    return {
      output: /verify/i.test(request.label)
        ? { accepted: true, reasons: [] }
        : { completed: true },
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }
}

function request(
  permission: AgentExecutionRequest["permission"] = "read",
): AgentExecutionRequest {
  return {
    runId: "extension-run",
    nodeId: "extension-node",
    label: "Extension node",
    prompt: "Return a bounded result.",
    permission,
    input: { private: "never-forward-this-value" },
    cwd: process.cwd(),
    timeoutMs: 1_000,
  };
}

test("custom executor names validate and run through a sealed registry", async () => {
  const executor = new FixtureExecutor();
  const registry = new GraphExtensionRegistry()
    .registerExecutor({ executor, permissions: ["read"] })
    .seal();
  const graph = planGraph({
    prompt: "Inspect one local file and verify the result.",
    primaryExecutor: executor.name,
    verifierExecutor: executor.name,
  });
  assert.equal(validateGraph(graph).valid, true);
  const directory = await mkdtemp(join(tmpdir(), "graph-extension-"));
  const result = await runGraph(graph, {
    executors: registry.executors(),
    auditDirectory: directory,
  });
  assert.equal(result.status, "completed");
  assert.equal(executor.calls, 2);
  assert.throws(
    () =>
      registry.registerExecutor({
        executor: new FixtureExecutor(),
        permissions: ["read"],
      }),
    /sealed/,
  );
});

test("executor extensions reject reserved names and permission escalation", async () => {
  const reserved = new FixtureExecutor();
  Object.defineProperty(reserved, "name", { value: "local" });
  assert.throws(
    () =>
      new GraphExtensionRegistry().registerExecutor({
        executor: reserved,
        permissions: ["read"],
      }),
    /invalid or reserved/,
  );

  const executor = new FixtureExecutor();
  const registered = new GraphExtensionRegistry()
    .registerExecutor({ executor, permissions: ["none", "read"] })
    .executors()[executor.name];
  assert.ok(registered);
  await assert.rejects(
    registered.execute(request("write")),
    /not authorized for write/,
  );
  assert.equal(executor.calls, 0);
});

test("executor extensions fail closed on malformed result usage", async () => {
  const executor: GraphExecutor = {
    name: "malformed-executor",
    async execute() {
      return {
        output: "unsafe",
        usage: { inputTokens: -1 },
      };
    },
  };
  const registered = new GraphExtensionRegistry()
    .registerExecutor({ executor, permissions: ["read"] })
    .executors()[executor.name];
  assert.ok(registered);
  await assert.rejects(
    registered.execute(request()),
    /invalid usage field inputTokens/,
  );
});

test("executor extensions preserve the hashed external security boundary", async () => {
  let observed:
    | {
        executor: string;
        promptSha256: string;
        inputSha256: string;
      }
    | undefined;
  const executor = new FixtureExecutor();
  const registered = new GraphExtensionRegistry({
    securityProvider: {
      async authorize(value) {
        observed = value;
        return { decision: "allow" };
      },
    },
  })
    .registerExecutor({ executor, permissions: ["read"] })
    .executors()[executor.name];
  assert.ok(registered);
  await registered.execute(request());
  assert.equal(observed?.executor, executor.name);
  assert.match(observed?.promptSha256 ?? "", /^[a-f0-9]{64}$/);
  assert.match(observed?.inputSha256 ?? "", /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(observed), /never-forward-this-value/);
});

test("extension graders append bounded criteria to the artifact grade", async () => {
  const executor = new FixtureExecutor();
  const registry = new GraphExtensionRegistry()
    .registerExecutor({ executor, permissions: ["read"] })
    .registerGrader({
      name: "fixture-grader",
      async grade(context) {
        assert.equal(context.checkpoint.status, "completed");
        return {
          criteria: [
            {
              id: "extension-proof",
              passed: true,
              detail: "fixture extension evidence passed",
            },
          ],
        };
      },
    })
    .seal();
  const graph = planGraph({
    prompt: "Inspect one local file and verify the result.",
    primaryExecutor: executor.name,
    verifierExecutor: executor.name,
  });
  const directory = await mkdtemp(join(tmpdir(), "graph-grader-extension-"));
  const run = await runGraph(graph, {
    executors: registry.executors(),
    auditDirectory: directory,
  });
  const grade = await gradeCheckpoint(directory, run.runId, {
    graders: registry.graders(),
  });
  assert.equal(grade.passed, true);
  assert.ok(
    grade.criteria.some(
      (criterion) =>
        criterion.id === "extension:fixture-grader:extension-proof",
    ),
  );
});

test("extension graders reject duplicate and oversized output", async () => {
  const context = {
    version: "1" as const,
    checkpoint: {
      status: "completed",
    } as GraphRunCheckpoint,
    auditEvents: [],
  };
  await assert.rejects(
    runExtensionGraders(
      [
        {
          name: "hostile-grader",
          async grade() {
            return {
              criteria: [
                { id: "same", passed: true, detail: "first" },
                { id: "same", passed: true, detail: "duplicate" },
              ],
            };
          },
        },
      ],
      context,
    ),
    /duplicate extension grade criterion/,
  );
  await assert.rejects(
    runExtensionGraders(
      [
        {
          name: "verbose-grader",
          async grade() {
            return {
              criteria: [
                { id: "detail", passed: true, detail: "x".repeat(1_001) },
              ],
            };
          },
        },
      ],
      context,
    ),
    /invalid criterion/,
  );
});
