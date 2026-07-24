import { compilePrompt } from "../packages/prompt-refiner/dist/index.js";
import {
  planGraph,
  validateGraph,
} from "../packages/graph-orchestrator/dist/index.js";

const prompt =
  process.argv.slice(2).join(" ") ||
  "Audit every service, keep the scope read-only, and verify every finding.";
const refinement = compilePrompt({ prompt });
const graph = planGraph({
  prompt,
  autonomy: "read_only",
  primaryExecutor: "codex",
  verifierExecutor: "claude",
  forceGraph: true,
});
const validation = validateGraph(graph);
if (!validation.valid) {
  throw new Error(
    `generated graph failed validation: ${validation.errors
      .map((error) => error.message)
      .join("; ")}`,
  );
}

process.stdout.write(`Original request
  ${refinement.originalPrompt}

Refined execution brief
  classification: ${refinement.classification}
  permissions: ${refinement.brief.permissionsRequired.join(", ") || "none"}
  acceptance: ${refinement.brief.acceptanceCriteria.join(" | ")}

Validated graph
  autonomy: ${graph.autonomy}
  nodes: ${validation.topologicalOrder.join(" -> ")}
  parallel limit: ${graph.budgets.maxParallel}
  repair limit: ${graph.budgets.maxRepairRounds}
  human gates: ${graph.nodes.filter((node) => node.kind === "human_gate").length}
  validation: passed
`);
