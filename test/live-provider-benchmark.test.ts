import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  runLiveBenchmark,
  validateLiveBenchmarkPlan,
} from "../scripts/live-provider-benchmark-lib.mjs";

const execute = promisify(execFile);

function plan() {
  return {
    version: "1.0",
    id: "public-study-v1",
    budgetUsd: 0.01,
    repetitions: 1,
    timeoutMs: 5_000,
    maxInputTokensPerRequest: 1_024,
    maxOutputTokensPerRequest: 100,
    providers: [
      {
        provider: "openai",
        model: "openai-exact-test-model",
        apiKeyEnv: "OPENAI_API_KEY",
        pricingUsdPerMillionTokens: {
          input: 2,
          cachedInput: 1,
          cacheCreationInput: 0,
          output: 4,
        },
      },
      {
        provider: "anthropic",
        model: "anthropic-exact-test-model",
        apiKeyEnv: "ANTHROPIC_API_KEY",
        pricingUsdPerMillionTokens: {
          input: 3,
          cachedInput: 0.3,
          cacheCreationInput: 3.75,
          output: 15,
        },
      },
    ],
    tasks: [
      {
        id: "task-one",
        prompt: "Return the phrase benchmark passed.",
        requiredPhrases: ["benchmark passed"],
      },
    ],
  };
}

test("validates a finite preregistered plan and hashes canonical JSON", () => {
  const original = plan();
  const reordered = {
    tasks: original.tasks,
    providers: original.providers,
    maxOutputTokensPerRequest: original.maxOutputTokensPerRequest,
    maxInputTokensPerRequest: original.maxInputTokensPerRequest,
    timeoutMs: original.timeoutMs,
    repetitions: original.repetitions,
    budgetUsd: original.budgetUsd,
    id: original.id,
    version: original.version,
  };
  const first = validateLiveBenchmarkPlan(original);
  const second = validateLiveBenchmarkPlan(reordered);
  assert.equal(first.planSha256, second.planSha256);
  assert.equal(first.requestCount, 2);
  assert.ok(first.maximumCostUsd <= original.budgetUsd);
});

test("rejects placeholders, wrong key names, low ceilings, and insufficient budgets", () => {
  const placeholder = plan();
  placeholder.providers[0].model = "REPLACE_WITH_MODEL_ID";
  assert.throws(() => validateLiveBenchmarkPlan(placeholder), /exact model id/);

  const key = plan();
  key.providers[0].apiKeyEnv = "SOME_OTHER_KEY";
  assert.throws(() => validateLiveBenchmarkPlan(key), /OPENAI_API_KEY/);

  const ceiling = plan();
  ceiling.maxInputTokensPerRequest = 256;
  ceiling.tasks[0].prompt = "x".repeat(257);
  assert.throws(() => validateLiveBenchmarkPlan(ceiling), /needs maxInput/);

  const budget = plan();
  budget.budgetUsd = 0.000001;
  assert.throws(() => validateLiveBenchmarkPlan(budget), /exceeds budgetUsd/);

  const unknown = { ...plan(), surprise: true };
  assert.throws(() => validateLiveBenchmarkPlan(unknown), /unsupported fields/);
});

test("dry-run never reads keys or invokes fetch", async () => {
  let called = false;
  const report = await runLiveBenchmark({
    plan: plan(),
    env: new Proxy(
      {},
      {
        get() {
          throw new Error("environment must not be read");
        },
      },
    ),
    fetchImpl: async () => {
      called = true;
      throw new Error("network must not be called");
    },
  });
  assert.equal(called, false);
  assert.equal(report.status, "ready");
  assert.equal(report.costUsd, 0);
});

test("live mode requires exact confirmation and all provider keys before fetch", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    throw new Error("must not run");
  };
  await assert.rejects(
    runLiveBenchmark({
      plan: plan(),
      execute: true,
      confirmedBudgetUsd: 0.02,
      env: {},
      fetchImpl,
    }),
    /exactly equal/,
  );
  await assert.rejects(
    runLiveBenchmark({
      plan: plan(),
      execute: true,
      confirmedBudgetUsd: 0.01,
      env: { OPENAI_API_KEY: "not-a-real-key" },
      fetchImpl,
    }),
    /ANTHROPIC_API_KEY/,
  );
  assert.equal(called, false);
});

test("mocked OpenAI and Anthropic calls are sequential and costed by provider semantics", async () => {
  const calls: Array<{ url: string; options: RequestInit }> = [];
  const responses = [
    {
      output: [{ content: [{ type: "output_text", text: "Benchmark passed." }] }],
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 20 },
        output_tokens: 10,
      },
    },
    {
      content: [{ type: "text", text: "Benchmark passed." }],
      usage: {
        input_tokens: 80,
        cache_read_input_tokens: 15,
        cache_creation_input_tokens: 5,
        output_tokens: 10,
      },
    },
  ];
  let active = 0;
  let maximumActive = 0;
  const fetchImpl = async (url: string | URL, options: RequestInit) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    calls.push({ url: String(url), options });
    const body = responses[calls.length - 1];
    active -= 1;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const report = await runLiveBenchmark({
    plan: plan(),
    execute: true,
    confirmedBudgetUsd: 0.01,
    env: {
      OPENAI_API_KEY: "openai-secret",
      ANTHROPIC_API_KEY: "anthropic-secret",
    },
    fetchImpl,
  });

  assert.equal(maximumActive, 1);
  assert.equal(report.status, "completed");
  assert.equal(report.passed, true);
  assert.equal(report.accountingComplete, true);
  assert.equal(report.costUsd, 0.00063325);
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(String(calls[0].options.body)).store, false);
  assert.equal(
    (calls[1].options.headers as Record<string, string>)["x-api-key"],
    "anthropic-secret",
  );
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("openai-secret"), false);
  assert.equal(serialized.includes("anthropic-secret"), false);
});

test("provider errors fail closed and mark accounting incomplete without leaking keys", async () => {
  const report = await runLiveBenchmark({
    plan: { ...plan(), providers: [plan().providers[0]] },
    execute: true,
    confirmedBudgetUsd: 0.01,
    env: { OPENAI_API_KEY: "never-print-this" },
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: { message: "synthetic failure" } }), {
        status: 429,
      }),
  });
  assert.equal(report.status, "failed");
  assert.equal(report.accountingComplete, false);
  assert.match(report.results[0].violations[0], /provider-side cost is unknown/);
  assert.equal(JSON.stringify(report).includes("never-print-this"), false);
});

test("thrown provider errors and malformed usage cannot leak keys or pass accounting", async () => {
  const secret = "never-print-this-either";
  const thrown = await runLiveBenchmark({
    plan: { ...plan(), providers: [plan().providers[0]] },
    execute: true,
    confirmedBudgetUsd: 0.01,
    env: { OPENAI_API_KEY: secret },
    fetchImpl: async () => {
      throw new Error(`transport included ${secret}`);
    },
  });
  assert.equal(thrown.accountingComplete, false);
  assert.equal(JSON.stringify(thrown).includes(secret), false);
  assert.match(JSON.stringify(thrown), /\[REDACTED\]/);

  const malformed = await runLiveBenchmark({
    plan: { ...plan(), providers: [plan().providers[0]] },
    execute: true,
    confirmedBudgetUsd: 0.01,
    env: { OPENAI_API_KEY: "test-only" },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          output: [],
          usage: { input_tokens: "100", output_tokens: 1 },
        }),
      ),
  });
  assert.equal(malformed.status, "failed");
  assert.equal(malformed.accountingComplete, false);
  assert.match(malformed.results[0].violations[0], /invalid input_tokens/);
});

test("actual provider usage above a preregistered ceiling fails the run", async () => {
  const report = await runLiveBenchmark({
    plan: { ...plan(), providers: [plan().providers[0]] },
    execute: true,
    confirmedBudgetUsd: 0.01,
    env: { OPENAI_API_KEY: "test-only" },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          output: [
            {
              content: [{ type: "output_text", text: "Benchmark passed." }],
            },
          ],
          usage: { input_tokens: 1_025, output_tokens: 1 },
        }),
      ),
  });
  assert.equal(report.status, "failed");
  assert.match(report.results[0].violations[0], /input tokens exceeded/);
});

test("bounded response parser rejects oversized provider responses", async () => {
  const report = await runLiveBenchmark({
    plan: { ...plan(), providers: [plan().providers[0]] },
    execute: true,
    confirmedBudgetUsd: 0.01,
    env: { OPENAI_API_KEY: "test-only" },
    fetchImpl: async () =>
      new Response("{}", {
        status: 200,
        headers: { "content-length": String(2 * 1024 * 1024 + 1) },
      }),
  });
  assert.equal(report.status, "failed");
  assert.match(report.results[0].violations[0], /response exceeds/);
});

test("CLI output artifacts are create-only", async () => {
  const directory = await mkdtemp(join(tmpdir(), "age-live-benchmark-"));
  const planPath = join(directory, "plan.json");
  const output = join(directory, "report.json");
  await writeFile(planPath, JSON.stringify(plan()), "utf8");
  await writeFile(output, "existing\n", "utf8");
  await assert.rejects(
    execute(
      process.execPath,
      [
        "scripts/live-provider-benchmark.mjs",
        "--plan",
        planPath,
        "--output",
        output,
        "--execute",
        "--confirm-budget-usd",
        "0.01",
      ],
      { cwd: process.cwd(), env: {} },
    ),
    /EEXIST/,
  );
  assert.equal(await readFile(output, "utf8"), "existing\n");
});
