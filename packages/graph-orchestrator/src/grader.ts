import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadCheckpoint } from "./persistence.js";
import { graphFingerprint } from "./runtime.js";
import { validateGraph } from "./validator.js";

export interface RunGradeCriterion {
  id: string;
  passed: boolean;
  detail: string;
}

export interface RunGrade {
  runId: string;
  passed: boolean;
  score: number;
  criteria: RunGradeCriterion[];
}

function selected(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export async function gradeCheckpoint(
  directory: string,
  runId: string,
): Promise<RunGrade> {
  const checkpoint = await loadCheckpoint(directory, runId);
  const validation = validateGraph(checkpoint.graph);
  const graphIntegrity =
    checkpoint.graphHash === graphFingerprint(checkpoint.graph);
  const auditPath = resolve(directory, `${runId}.jsonl`);
  const events = (await readFile(auditPath, "utf8"))
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as {
      sequence?: number;
      runId?: string;
      type?: string;
    });
  const auditSequence = events.every(
    (event, index) =>
      event.sequence === index + 1 && event.runId === checkpoint.runId,
  );
  const terminalEvent =
    checkpoint.status === "completed"
      ? "run_completed"
      : checkpoint.status === "failed"
        ? "run_failed"
        : checkpoint.status === "needs_confirmation"
          ? "run_blocked"
          : undefined;
  const lifecycleTerminal =
    terminalEvent !== undefined && events.at(-1)?.type === terminalEvent;
  const nodeStatesConsistent =
    checkpoint.status !== "completed" ||
    checkpoint.graph.nodes.every(
      (node) => checkpoint.nodes[node.id]?.state === "completed",
    );
  const policy = checkpoint.graph.repairPolicy;
  const acceptancePassed =
    checkpoint.status === "completed" &&
    (!policy ||
      selected(
        checkpoint.outputs[policy.verifierNodeId],
        policy.acceptedField,
      ) === true);
  const consumed =
    (checkpoint.usage.inputTokens ?? 0) +
    (checkpoint.usage.outputTokens ?? 0);
  const usageWithinBudget =
    consumed <=
    (checkpoint.graph.budgets.maxActualTokens ??
      checkpoint.graph.budgets.maxEstimatedTokens);
  const criteria: RunGradeCriterion[] = [
    {
      id: "graph-valid",
      passed: validation.valid,
      detail: validation.valid
        ? "graph contract is valid"
        : validation.errors.map((issue) => issue.code).join(", "),
    },
    {
      id: "graph-integrity",
      passed: graphIntegrity,
      detail: graphIntegrity
        ? "checkpoint fingerprint matches"
        : "checkpoint graph fingerprint mismatch",
    },
    {
      id: "audit-sequence",
      passed: auditSequence,
      detail: auditSequence
        ? `${events.length} ordered events`
        : "audit sequence or run ID is inconsistent",
    },
    {
      id: "terminal-lifecycle",
      passed: lifecycleTerminal,
      detail: lifecycleTerminal
        ? `terminal event matches ${checkpoint.status}`
        : "checkpoint status and terminal audit event disagree",
    },
    {
      id: "node-state-consistency",
      passed: nodeStatesConsistent,
      detail: nodeStatesConsistent
        ? "node states match the terminal status"
        : "completed run contains incomplete nodes",
    },
    {
      id: "acceptance",
      passed: acceptancePassed,
      detail: acceptancePassed
        ? "final verifier accepted the candidate"
        : "run is not completed with an accepted verifier result",
    },
    {
      id: "actual-token-budget",
      passed: usageWithinBudget,
      detail: `${consumed}/${checkpoint.graph.budgets.maxActualTokens ?? checkpoint.graph.budgets.maxEstimatedTokens} tokens`,
    },
  ];
  const passedCount = criteria.filter((criterion) => criterion.passed).length;
  return {
    runId: checkpoint.runId,
    passed: passedCount === criteria.length,
    score: passedCount / criteria.length,
    criteria,
  };
}
