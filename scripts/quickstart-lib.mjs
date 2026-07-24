import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { compilePrompt } from "../packages/prompt-refiner/dist/index.js";
import {
  planGraph,
  validateGraph,
} from "../packages/graph-orchestrator/dist/index.js";
import { runDoctor } from "../packages/graph-orchestrator/dist/doctor.js";

export const QUICKSTART_PROMPT =
  "Audit every service, keep the scope read-only, and verify every finding.";

export function assembleQuickstartReport({
  doctor,
  refinement,
  promptPreserved,
  graph,
  validation,
  examples,
}) {
  const steps = [
    {
      id: "environment",
      passed: doctor.status === "ready" && doctor.summary.failures === 0,
      evidence: {
        checksPassed: doctor.summary.passed,
        optionalWarnings: doctor.summary.warnings,
        failures: doctor.summary.failures,
      },
    },
    {
      id: "prompt-refinement",
      passed:
        refinement.status === "ready" &&
        promptPreserved &&
        refinement.brief.permissionsRequired.length === 0,
      evidence: {
        classification: refinement.classification,
        permissionsRequired: refinement.brief.permissionsRequired,
        originalPromptPreserved: promptPreserved,
      },
    },
    {
      id: "generated-workflow",
      passed:
        graph.autonomy === "read_only" &&
        validation.valid &&
        graph.nodes.every(
          (node) =>
            node.permission !== "external" &&
            node.permission !== "destructive",
        ),
      evidence: {
        autonomy: graph.autonomy,
        nodes: graph.nodes.length,
        maxParallel: graph.budgets.maxParallel,
        maxRepairRounds: graph.budgets.maxRepairRounds,
        humanGates: graph.nodes.filter((node) => node.kind === "human_gate")
          .length,
        validationErrors: validation.errors.length,
      },
    },
    {
      id: "committed-workflows",
      passed:
        examples.length > 0 &&
        examples.every(
          (example) => example.schemaValid && example.runtimeValid,
        ),
      evidence: {
        total: examples.length,
        schemaValid: examples.filter((example) => example.schemaValid).length,
        runtimeValid: examples.filter((example) => example.runtimeValid).length,
        workflows: examples.map((example) => example.workflow),
      },
    },
  ];
  const passed = steps.filter((step) => step.passed).length;
  return {
    version: "1.0",
    journey: "installation-to-first-validated-workflow",
    status: passed === steps.length ? "ready" : "blocked",
    offline: true,
    providerCredentialsRequired: false,
    steps,
    summary: {
      total: steps.length,
      passed,
      failed: steps.length - passed,
    },
  };
}

export async function runQuickstartJourney(repositoryRoot) {
  const doctor = await runDoctor({ root: repositoryRoot });
  const refinement = compilePrompt({ prompt: QUICKSTART_PROMPT });
  const graph = planGraph({
    prompt: QUICKSTART_PROMPT,
    autonomy: "read_only",
    primaryExecutor: "codex",
    verifierExecutor: "claude",
    forceGraph: true,
  });
  const validation = validateGraph(graph);
  const graphSchema = JSON.parse(
    await readFile(
      join(repositoryRoot, "schemas", "autonomous-graph.schema.json"),
      "utf8",
    ),
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validateSchema = ajv.compile(graphSchema);
  const workflowFiles = (await readdir(join(repositoryRoot, "examples")))
    .filter((file) => file.endsWith(".graph.json"))
    .sort();
  const examples = await Promise.all(
    workflowFiles.map(async (file) => {
      const workflow = file.replace(".graph.json", "");
      const example = JSON.parse(
        await readFile(join(repositoryRoot, "examples", file), "utf8"),
      );
      const schemaValid = validateSchema(example);
      const runtimeValid = validateGraph(example).valid;
      return { workflow, schemaValid, runtimeValid };
    }),
  );
  return assembleQuickstartReport({
    doctor,
    refinement,
    promptPreserved: refinement.originalPrompt === QUICKSTART_PROMPT,
    graph,
    validation,
    examples,
  });
}

export function renderQuickstartReport(report) {
  const lines = [`GraphVigil first workflow: ${report.status}`];
  for (const step of report.steps) {
    lines.push(`[${step.passed ? "PASS" : "FAIL"}] ${step.id}`);
  }
  lines.push(
    `${report.summary.passed}/${report.summary.total} journey steps passed; offline and credential-free`,
  );
  return `${lines.join("\n")}\n`;
}
