import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { planGraph } from "../packages/graph-orchestrator/src/planner.js";
import { validateGraph } from "../packages/graph-orchestrator/src/validator.js";
import { compilePrompt } from "../packages/prompt-refiner/src/compiler.js";
import { runLiveBenchmark } from "../scripts/live-provider-benchmark-lib.mjs";

const execute = promisify(execFile);

async function schema(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(new URL(`../schemas/${name}`, import.meta.url), "utf8"),
  ) as Record<string, unknown>;
}

async function validator(name: string) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(await schema(name));
}

test("public prompt schema accepts real compiler output", async () => {
  const validate = await validator("prompt-refinement.schema.json");
  const result = compilePrompt({
    prompt: "Review the authentication code and report risks.",
  });

  assert.equal(validate(result), true, JSON.stringify(validate.errors, null, 2));
  const malformed = { ...result, provider: "untrusted-provider" };
  assert.equal(validate(malformed), false);
});

test("public graph schema and runtime validator agree on core budgets", async () => {
  const validateSchema = await validator("autonomous-graph.schema.json");
  const graph = planGraph({
    prompt: "Audit every package and verify every finding.",
    forceGraph: true,
  });

  assert.equal(
    validateSchema(graph),
    true,
    JSON.stringify(validateSchema.errors, null, 2),
  );
  assert.equal(validateGraph(graph).valid, true);

  graph.budgets.maxParallel = 0;
  assert.equal(validateSchema(graph), false);
  assert.ok(
    validateGraph(graph).errors.some(
      (issue) => issue.code === "INVALID_PARALLEL_BUDGET",
    ),
  );

  const reservedIdGraph = planGraph({ prompt: "Explain this function." });
  const firstNode = reservedIdGraph.nodes[0];
  assert.ok(firstNode);
  firstNode.id = "constructor";
  assert.equal(validateSchema(reservedIdGraph), false);
  assert.ok(
    validateGraph(reservedIdGraph).errors.some(
      (issue) => issue.code === "INVALID_NODE_ID",
    ),
  );
});

test("starter repository-audit graph satisfies both public contracts", async () => {
  const validateSchema = await validator("autonomous-graph.schema.json");
  const graph = JSON.parse(
    await readFile(
      new URL("../examples/repository-audit.graph.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    validateSchema(graph),
    true,
    JSON.stringify(validateSchema.errors, null, 2),
  );
  assert.equal(validateGraph(graph).valid, true);
});

test("doctor output satisfies its strict public report schema", async () => {
  const validate = await validator("doctor-report.schema.json");
  const { stdout } = await execute(
    process.execPath,
    ["scripts/doctor.mjs", "--json"],
    { cwd: process.cwd() },
  );
  const report = JSON.parse(stdout);
  assert.equal(
    validate(report),
    true,
    JSON.stringify(validate.errors, null, 2),
  );
});

test("benchmark output satisfies its strict public report schema", async () => {
  const validate = await validator("benchmark-report.schema.json");
  const { stdout } = await execute(
    process.execPath,
    ["scripts/benchmark.mjs"],
    { cwd: process.cwd() },
  );
  const report = JSON.parse(stdout);
  assert.equal(
    validate(report),
    true,
    JSON.stringify(validate.errors, null, 2),
  );
});

test("provider-envelope benchmark satisfies its strict public report schema", async () => {
  const validate = await validator("provider-benchmark-report.schema.json");
  const { stdout } = await execute(
    process.execPath,
    ["scripts/provider-benchmark.mjs"],
    { cwd: process.cwd() },
  );
  const report = JSON.parse(stdout);
  assert.equal(
    validate(report),
    true,
    JSON.stringify(validate.errors, null, 2),
  );
});

test("live provider benchmark dry-run satisfies its strict public contracts", async () => {
  const validatePlan = await validator("live-provider-benchmark-plan.schema.json");
  const validateReport = await validator(
    "live-provider-benchmark-report.schema.json",
  );
  const plan = {
    version: "1.0",
    id: "schema-contract-v1",
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
    ],
    tasks: [
      {
        id: "schema-task",
        prompt: "Return schema contract passed.",
        requiredPhrases: ["schema contract passed"],
      },
    ],
  };
  assert.equal(
    validatePlan(plan),
    true,
    JSON.stringify(validatePlan.errors, null, 2),
  );
  const directory = await mkdtemp(join(tmpdir(), "age-live-schema-"));
  const planPath = join(directory, "plan.json");
  await writeFile(planPath, JSON.stringify(plan));
  const { stdout } = await execute(
    process.execPath,
    ["scripts/live-provider-benchmark.mjs", "--plan", planPath],
    { cwd: process.cwd() },
  );
  const report = JSON.parse(stdout);
  assert.equal(
    validateReport(report),
    true,
    JSON.stringify(validateReport.errors, null, 2),
  );

  const liveReport = await runLiveBenchmark({
    plan,
    execute: true,
    confirmedBudgetUsd: plan.budgetUsd,
    env: { OPENAI_API_KEY: "synthetic-test-key" },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          output: [
            {
              content: [
                { type: "output_text", text: "Schema contract passed." },
              ],
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      ),
  });
  assert.equal(
    validateReport(liveReport),
    true,
    JSON.stringify(validateReport.errors, null, 2),
  );
});
