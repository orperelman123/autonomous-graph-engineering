import { randomUUID } from "node:crypto";
import { compilePrompt } from "@autonomous-graph-engineering/prompt-refiner";
import type {
  AutonomyLevel,
  GraphBudgets,
  GraphNode,
  GraphSpec,
  PlanGraphRequest,
} from "./types.js";

const DEFAULT_BUDGETS: GraphBudgets = {
  maxNodes: 16,
  maxParallel: 4,
  maxFanout: 8,
  maxDepth: 9,
  maxRepairRounds: 2,
  timeoutMs: 15 * 60 * 1000,
  maxEstimatedTokens: 200_000,
  maxActualTokens: 500_000,
};

function complexityScore(prompt: string): number {
  let score = 0;
  if (prompt.length > 300) score += 2;
  if (prompt.length > 800) score += 2;
  if ((prompt.match(/\r?\n/g) ?? []).length >= 3) score += 2;
  if (
    /\b(every|all|multiple|across|compare|research|audit|fleet|parallel|independent|sources|files|routes|services)\b/i.test(
      prompt,
    )
  ) {
    score += 3;
  }
  if (
    /\b(verify|adversarial|cross-check|different perspectives|security and performance)\b/i.test(
      prompt,
    )
  ) {
    score += 2;
  }
  if (/\b(then|after|before|depends on|based on)\b/i.test(prompt)) score += 1;
  return Math.min(score, 10);
}
function permissionFor(
  autonomy: AutonomyLevel,
  classification: string,
): GraphNode["permission"] {
  if (classification === "destructive_action") return "destructive";
  if (classification === "external_action") return "external";
  if (autonomy === "workspace" || autonomy === "consequential") return "write";
  return "read";
}

function directNodes(
  goal: string,
  permission: GraphNode["permission"],
  primary: "codex" | "claude" | "local",
  verifier: "codex" | "claude" | "local",
): GraphNode[] {
  return [
    {
      id: "execute",
      label: "Execute focused request",
      kind: "agent",
      dependsOn: [],
      permission,
      executor: primary,
      prompt: goal,
      isolation: "shared",
    },
    {
      id: "verify",
      label: "Verify result against acceptance criteria",
      kind: "verifier",
      dependsOn: ["execute"],
      permission: "read",
      executor: verifier,
      prompt:
        "Verify the candidate against the original request and acceptance criteria. Return JSON with accepted:boolean and reasons:string[].",
      outputSchema: {
        type: "object",
        required: ["accepted", "reasons"],
        properties: {
          accepted: { type: "boolean" },
          reasons: { type: "array", items: { type: "string" } },
        },
      },
    },
  ];
}

function graphNodes(
  goal: string,
  permission: GraphNode["permission"],
  primary: "codex" | "claude" | "local",
  verifier: "codex" | "claude" | "local",
): GraphNode[] {
  const nodes: GraphNode[] = [
    {
      id: "scope",
      label: "Decompose objective into independent work items",
      kind: "agent",
      dependsOn: [],
      permission: "read",
      executor: primary,
      prompt: `Decompose this objective into independent bounded work items: ${goal}. Return JSON {"items":[{"id":"...","task":"..."}]}.`,
      outputSchema: {
        type: "object",
        required: ["items"],
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "task"],
              properties: {
                id: { type: "string" },
                task: { type: "string" },
              },
            },
          },
        },
      },
    },
    {
      id: "investigate",
      label: "Execute independent work items",
      kind: "parallel_map",
      dependsOn: ["scope"],
      permission: "read",
      executor: primary,
      inputPath: "items",
      maxConcurrency: 4,
      prompt:
        "Complete this bounded work item. Return evidence, findings, uncertainty, and verification steps.",
    },
    {
      id: "reduce",
      label: "Deterministically collect and deduplicate results",
      kind: "reduce",
      dependsOn: ["investigate"],
      permission: "none",
      operation: "dedupe",
    },
    {
      id: "cross_check",
      label: "Adversarially verify collected results",
      kind: "parallel_map",
      dependsOn: ["reduce"],
      permission: "read",
      executor: verifier,
      maxConcurrency: 4,
      prompt:
        "Try to disprove this finding. Return JSON with accepted:boolean, reasons:string[], and correctedFinding if needed.",
    },
    {
      id: "synthesize",
      label: "Synthesize verified result",
      kind: "agent",
      dependsOn: ["cross_check"],
      permission: "read",
      executor: primary,
      prompt:
        "Synthesize only findings that survived verification. Preserve evidence, uncertainty, and unresolved disagreements.",
    },
  ];

  if (permission === "write") {
    nodes.push({
      id: "implement",
      label: "Apply the verified implementation plan",
      kind: "agent",
      dependsOn: ["synthesize"],
      permission: "write",
      executor: primary,
      prompt:
        "Implement the verified plan in the current workspace, make the smallest coherent changes, and run focused checks.",
      isolation: "shared",
    });
  }

  const candidateNodeId = permission === "write" ? "implement" : "synthesize";
  nodes.push({
    id: "acceptance",
    label: "Evaluate final acceptance criteria",
    kind: "verifier",
    dependsOn: [candidateNodeId],
    permission: "read",
    executor: verifier,
    prompt:
      "Evaluate the final candidate against the original goal and all acceptance criteria. Return JSON with accepted:boolean and reasons:string[].",
    outputSchema: {
      type: "object",
      required: ["accepted", "reasons"],
      properties: {
        accepted: { type: "boolean" },
        reasons: { type: "array", items: { type: "string" } },
      },
    },
  });
  return nodes;
}

export function planGraph(request: PlanGraphRequest): GraphSpec {
  const refinement = compilePrompt({ prompt: request.prompt });
  const autonomy = request.autonomy ?? "read_only";
  const primary = request.primaryExecutor ?? "codex";
  const verifier = request.verifierExecutor ?? primary;
  const score = complexityScore(request.prompt);
  const permission = permissionFor(autonomy, refinement.classification);
  const consequential =
    permission === "external" || permission === "destructive";
  const useGraph = request.forceGraph === true || score >= 4;

  let routing: GraphSpec["metadata"]["routing"] = useGraph
    ? "graph"
    : "direct";
  let nodes = useGraph
    ? graphNodes(refinement.brief.objective, permission, primary, verifier)
    : directNodes(refinement.brief.objective, permission, primary, verifier);

  if (consequential) {
    routing = "human_gate";
    const confirmation: GraphNode = {
      id: "confirm",
      label: "Confirm consequential action",
      kind: "human_gate",
      dependsOn: useGraph ? ["synthesize"] : [],
      permission: "none",
      metadata: {
        reason:
          refinement.confirmationReason ??
          "The action has an external or destructive side effect.",
      },
    };
    if (useGraph) {
      const acceptance = nodes.find((node) => node.id === "acceptance");
      const beforeAcceptance = nodes.filter((node) => node.id !== "acceptance");
      const action: GraphNode = {
        id: "act",
        label: "Perform the explicitly approved consequential action",
        kind: "agent",
        dependsOn: ["synthesize", "confirm"],
        permission,
        executor: primary,
        prompt:
          "Perform only the external or destructive action explicitly requested by the original goal, following the verified synthesis and exact human approval. Return structured evidence of the outcome.",
        isolation: "shared",
      };
      nodes = [
        ...beforeAcceptance,
        confirmation,
        action,
        ...(acceptance ? [{ ...acceptance, dependsOn: ["act"] }] : []),
      ];
    } else {
      nodes = [
        confirmation,
        ...nodes.map((node) =>
          node.dependsOn.length === 0
            ? { ...node, dependsOn: ["confirm"] }
            : node,
        ),
      ];
    }
  }

  const candidateNodeId = nodes.some((node) => node.id === "act")
    ? "act"
    : nodes.some((node) => node.id === "implement")
    ? "implement"
    : nodes.some((node) => node.id === "synthesize")
      ? "synthesize"
      : "execute";
  const verifierNodeId = nodes.some((node) => node.id === "acceptance")
    ? "acceptance"
    : "verify";

  return {
    version: "1.0",
    id: randomUUID(),
    goal: refinement.brief.objective,
    originalPromptHash: refinement.originalPromptHash,
    autonomy,
    createdAt: new Date().toISOString(),
    budgets: { ...DEFAULT_BUDGETS },
    nodes,
    repairPolicy: {
      enabled: !consequential && permission !== "write",
      candidateNodeId,
      verifierNodeId,
      acceptedField: "accepted",
      repairExecutor: primary,
      repairPrompt:
        permission === "write"
          ? "Repair only the acceptance failures using the original goal, existing candidate, and verifier feedback. Apply only in-scope workspace changes and do not expand permissions."
          : "Revise the candidate analysis or report to address only the verifier feedback and satisfy the original goal. Do not change files, expand scope, or expand permissions.",
    },
    metadata: {
      routing,
      complexityScore: score,
      planner: "deterministic",
      refinement,
    },
  };
}

