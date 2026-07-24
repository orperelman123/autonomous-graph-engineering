import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { planGraph } from "../packages/graph-orchestrator/src/planner.js";
import { validateGraph } from "../packages/graph-orchestrator/src/validator.js";
import { compilePrompt } from "../packages/prompt-refiner/src/compiler.js";

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
});
