import type {
  AutonomyLevel,
  GraphNode,
  GraphSpec,
  GraphValidationResult,
  NodePermission,
  ValidationIssue,
} from "./types.js";

const NODE_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const AUTONOMY_LEVELS = new Set([
  "plan_only",
  "read_only",
  "workspace",
  "consequential",
]);
const NODE_KINDS = new Set([
  "deterministic",
  "agent",
  "parallel_map",
  "reduce",
  "verifier",
  "human_gate",
]);
const NODE_PERMISSIONS = new Set([
  "none",
  "read",
  "write",
  "external",
  "destructive",
]);
const EXECUTORS = new Set(["codex", "claude", "local"]);
const OPERATIONS = new Set(["identity", "collect", "flatten", "dedupe"]);
const GRAPH_FIELDS = new Set([
  "version",
  "id",
  "goal",
  "originalPromptHash",
  "autonomy",
  "createdAt",
  "budgets",
  "nodes",
  "repairPolicy",
  "metadata",
]);
const NODE_FIELDS = new Set([
  "id",
  "label",
  "kind",
  "dependsOn",
  "permission",
  "executor",
  "prompt",
  "operation",
  "inputPath",
  "maxConcurrency",
  "outputSchema",
  "isolation",
  "metadata",
]);
const PERMISSION_RANK: Record<NodePermission, number> = {
  none: 0,
  read: 1,
  write: 2,
  external: 3,
  destructive: 4,
};
const AUTONOMY_RANK: Record<AutonomyLevel, number> = {
  plan_only: 0,
  read_only: 1,
  workspace: 2,
  consequential: 4,
};

function topologicalSort(
  nodes: GraphNode[],
): { order: string[]; cycle: boolean } {
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const node of nodes) {
    for (const dependency of node.dependsOn) {
      if (!indegree.has(dependency)) continue;
      indegree.set(node.id, (indegree.get(node.id) ?? 0) + 1);
      outgoing.get(dependency)?.push(node.id);
    }
  }
  const queue = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id)
    .sort();
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) break;
    order.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const value = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, value);
      if (value === 0) queue.push(next);
    }
    queue.sort();
  }
  return { order, cycle: order.length !== nodes.length };
}

function graphDepth(nodes: GraphNode[], order: string[]): number {
  const depth = new Map<string, number>();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const id of order) {
    const node = byId.get(id);
    if (!node) continue;
    depth.set(
      id,
      1 +
        Math.max(
          0,
          ...node.dependsOn.map((dependency) => depth.get(dependency) ?? 0),
        ),
    );
  }
  return Math.max(0, ...depth.values());
}

function ancestors(nodes: GraphNode[], nodeId: string): Set<string> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const result = new Set<string>();
  const visit = (id: string): void => {
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      if (result.has(dependency)) continue;
      result.add(dependency);
      visit(dependency);
    }
  };
  visit(nodeId);
  return result;
}

function hasGateAncestor(nodes: GraphNode[], node: GraphNode): boolean {
  const byId = new Map(nodes.map((item) => [item.id, item]));
  return [...ancestors(nodes, node.id)].some(
    (id) => byId.get(id)?.kind === "human_gate",
  );
}

function graphShapeIssues(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [{ code: "INVALID_GRAPH_SHAPE", message: "graph must be an object" }];
  }
  const graph = value as Record<string, unknown>;
  for (const field of Object.keys(graph)) {
    if (!GRAPH_FIELDS.has(field)) {
      issues.push({
        code: "UNKNOWN_GRAPH_FIELD",
        message: `unsupported graph field: ${field}`,
      });
    }
  }
  if (graph.version !== "1.0") {
    issues.push({ code: "INVALID_GRAPH_VERSION", message: "version must be 1.0" });
  }
  for (const field of ["id", "goal", "originalPromptHash", "createdAt"]) {
    if (typeof graph[field] !== "string" || graph[field] === "") {
      issues.push({
        code: "INVALID_GRAPH_SHAPE",
        message: `${field} must be a non-empty string`,
      });
    }
  }
  if (
    typeof graph.autonomy !== "string" ||
    !AUTONOMY_LEVELS.has(graph.autonomy)
  ) {
    issues.push({
      code: "INVALID_AUTONOMY",
      message: "autonomy is not supported",
    });
  }
  const budgets =
    graph.budgets &&
    typeof graph.budgets === "object" &&
    !Array.isArray(graph.budgets)
      ? (graph.budgets as Record<string, unknown>)
      : undefined;
  if (!budgets) {
    issues.push({ code: "INVALID_BUDGETS", message: "budgets must be an object" });
  } else {
    for (const field of [
      "maxNodes",
      "maxParallel",
      "maxFanout",
      "maxDepth",
      "maxRepairRounds",
      "timeoutMs",
      "maxEstimatedTokens",
    ]) {
      if (
        typeof budgets[field] !== "number" ||
        !Number.isFinite(budgets[field]) ||
        !Number.isInteger(budgets[field])
      ) {
        issues.push({
          code: "INVALID_BUDGET_VALUE",
          message: `${field} must be a finite integer`,
        });
      }
    }
    if (
      budgets.maxActualTokens !== undefined &&
      (typeof budgets.maxActualTokens !== "number" ||
        !Number.isFinite(budgets.maxActualTokens) ||
        !Number.isInteger(budgets.maxActualTokens) ||
        budgets.maxActualTokens < 1)
    ) {
      issues.push({
        code: "INVALID_BUDGET_VALUE",
        message: "maxActualTokens must be a positive finite integer",
      });
    }
    if (
      typeof budgets.maxParallel === "number" &&
      Number.isFinite(budgets.maxParallel) &&
      Number.isInteger(budgets.maxParallel) &&
      (budgets.maxParallel < 1 || budgets.maxParallel > 100)
    ) {
      issues.push({
        code: "INVALID_PARALLEL_BUDGET",
        message: "maxParallel must be an integer between 1 and 100",
      });
    }
  }
  if (!Array.isArray(graph.nodes)) {
    issues.push({ code: "INVALID_NODES", message: "nodes must be an array" });
    return issues;
  }
  graph.nodes.forEach((rawNode, index) => {
    if (!rawNode || typeof rawNode !== "object" || Array.isArray(rawNode)) {
      issues.push({
        code: "INVALID_NODE_SHAPE",
        message: `node ${index} must be an object`,
      });
      return;
    }
    const node = rawNode as Record<string, unknown>;
    const nodeId = typeof node.id === "string" ? node.id : undefined;
    for (const field of Object.keys(node)) {
      if (!NODE_FIELDS.has(field)) {
        issues.push({
          code: "UNKNOWN_NODE_FIELD",
          ...(nodeId ? { nodeId } : {}),
          message: `unsupported node field: ${field}`,
        });
      }
    }
    if (!nodeId || typeof node.label !== "string") {
      issues.push({
        code: "INVALID_NODE_SHAPE",
        ...(nodeId ? { nodeId } : {}),
        message: `node ${index} requires string id and label`,
      });
    }
    if (typeof node.kind !== "string" || !NODE_KINDS.has(node.kind)) {
      issues.push({
        code: "INVALID_NODE_KIND",
        ...(nodeId ? { nodeId } : {}),
        message: "node kind is not supported",
      });
    }
    if (
      typeof node.permission !== "string" ||
      !NODE_PERMISSIONS.has(node.permission)
    ) {
      issues.push({
        code: "INVALID_NODE_PERMISSION",
        ...(nodeId ? { nodeId } : {}),
        message: "node permission is not supported",
      });
    }
    if (
      !Array.isArray(node.dependsOn) ||
      !node.dependsOn.every((entry) => typeof entry === "string")
    ) {
      issues.push({
        code: "INVALID_DEPENDENCIES",
        ...(nodeId ? { nodeId } : {}),
        message: "dependsOn must be an array of strings",
      });
    }
    if (
      node.executor !== undefined &&
      (typeof node.executor !== "string" || !EXECUTORS.has(node.executor))
    ) {
      issues.push({
        code: "INVALID_EXECUTOR",
        ...(nodeId ? { nodeId } : {}),
        message: "executor is not supported",
      });
    }
    if (
      node.operation !== undefined &&
      (typeof node.operation !== "string" || !OPERATIONS.has(node.operation))
    ) {
      issues.push({
        code: "INVALID_OPERATION",
        ...(nodeId ? { nodeId } : {}),
        message: "operation is not supported",
      });
    }
    for (const field of ["prompt", "inputPath"]) {
      if (node[field] !== undefined && typeof node[field] !== "string") {
        issues.push({
          code: "INVALID_NODE_FIELD",
          ...(nodeId ? { nodeId } : {}),
          message: `${field} must be a string`,
        });
      }
    }
    if (
      node.maxConcurrency !== undefined &&
      (typeof node.maxConcurrency !== "number" ||
        !Number.isInteger(node.maxConcurrency) ||
        node.maxConcurrency < 1)
    ) {
      issues.push({
        code: "INVALID_NODE_FIELD",
        ...(nodeId ? { nodeId } : {}),
        message: "maxConcurrency must be a positive integer",
      });
    }
    if (
      node.outputSchema !== undefined &&
      (!node.outputSchema ||
        typeof node.outputSchema !== "object" ||
        Array.isArray(node.outputSchema))
    ) {
      issues.push({
        code: "INVALID_NODE_FIELD",
        ...(nodeId ? { nodeId } : {}),
        message: "outputSchema must be an object",
      });
    }
    if (
      node.isolation !== undefined &&
      node.isolation !== "shared" &&
      node.isolation !== "worktree"
    ) {
      issues.push({
        code: "INVALID_NODE_FIELD",
        ...(nodeId ? { nodeId } : {}),
        message: "isolation must be shared or worktree",
      });
    }
    if (
      node.metadata !== undefined &&
      (!node.metadata ||
        typeof node.metadata !== "object" ||
        Array.isArray(node.metadata))
    ) {
      issues.push({
        code: "INVALID_NODE_FIELD",
        ...(nodeId ? { nodeId } : {}),
        message: "metadata must be an object",
      });
    }
  });
  if (
    !graph.metadata ||
    typeof graph.metadata !== "object" ||
    Array.isArray(graph.metadata)
  ) {
    issues.push({
      code: "INVALID_GRAPH_METADATA",
      message: "metadata must be an object",
    });
  }
  if (graph.repairPolicy !== undefined) {
    if (
      !graph.repairPolicy ||
      typeof graph.repairPolicy !== "object" ||
      Array.isArray(graph.repairPolicy)
    ) {
      issues.push({
        code: "INVALID_REPAIR_POLICY",
        message: "repairPolicy must be an object",
      });
    } else {
      const policy = graph.repairPolicy as Record<string, unknown>;
      const allowed = new Set([
        "enabled",
        "candidateNodeId",
        "verifierNodeId",
        "acceptedField",
        "repairExecutor",
        "repairPrompt",
      ]);
      for (const field of Object.keys(policy)) {
        if (!allowed.has(field)) {
          issues.push({
            code: "INVALID_REPAIR_POLICY",
            message: `unsupported repairPolicy field: ${field}`,
          });
        }
      }
      if (typeof policy.enabled !== "boolean") {
        issues.push({
          code: "INVALID_REPAIR_POLICY",
          message: "repairPolicy.enabled must be boolean",
        });
      }
      for (const field of [
        "candidateNodeId",
        "verifierNodeId",
        "acceptedField",
        "repairPrompt",
      ]) {
        if (typeof policy[field] !== "string" || policy[field] === "") {
          issues.push({
            code: "INVALID_REPAIR_POLICY",
            message: `repairPolicy.${field} must be a non-empty string`,
          });
        }
      }
      if (
        typeof policy.repairExecutor !== "string" ||
        !EXECUTORS.has(policy.repairExecutor)
      ) {
        issues.push({
          code: "INVALID_REPAIR_POLICY",
          message: "repairPolicy.repairExecutor is not supported",
        });
      }
    }
  }
  return issues;
}

export function validateGraph(graph: GraphSpec): GraphValidationResult {
  const shapeErrors = graphShapeIssues(graph);
  if (shapeErrors.length > 0) {
    return {
      valid: false,
      errors: shapeErrors,
      warnings: [],
      topologicalOrder: [],
      depth: 0,
      estimatedTokens: 0,
    };
  }
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const ids = new Set<string>();

  if (graph.nodes.length === 0) {
    errors.push({ code: "EMPTY_GRAPH", message: "graph has no nodes" });
  }
  if (graph.nodes.length > graph.budgets.maxNodes) {
    errors.push({
      code: "NODE_BUDGET_EXCEEDED",
      message: `${graph.nodes.length} nodes exceeds maxNodes ${graph.budgets.maxNodes}`,
    });
  }
  for (const node of graph.nodes) {
    if (!NODE_ID.test(node.id)) {
      errors.push({
        code: "INVALID_NODE_ID",
        nodeId: node.id,
        message: `invalid node id: ${node.id}`,
      });
    }
    if (ids.has(node.id)) {
      errors.push({
        code: "DUPLICATE_NODE",
        nodeId: node.id,
        message: `duplicate node id: ${node.id}`,
      });
    }
    ids.add(node.id);
    if (node.dependsOn.includes(node.id)) {
      errors.push({
        code: "SELF_DEPENDENCY",
        nodeId: node.id,
        message: "node depends on itself",
      });
    }
    if (
      (node.kind === "agent" ||
        node.kind === "parallel_map" ||
        node.kind === "verifier") &&
      !node.executor
    ) {
      errors.push({
        code: "MISSING_EXECUTOR",
        nodeId: node.id,
        message: `${node.kind} node requires an executor`,
      });
    }
    if (
      node.kind === "parallel_map" &&
      (node.maxConcurrency ?? 1) > graph.budgets.maxParallel
    ) {
      errors.push({
        code: "PARALLEL_BUDGET_EXCEEDED",
        nodeId: node.id,
        message: `node concurrency exceeds maxParallel ${graph.budgets.maxParallel}`,
      });
    }
    if (
      graph.autonomy !== "plan_only" &&
      PERMISSION_RANK[node.permission] > AUTONOMY_RANK[graph.autonomy]
    ) {
      const issue = {
        code: "PERMISSION_EXCEEDS_AUTONOMY",
        nodeId: node.id,
        message: `${node.permission} permission exceeds ${graph.autonomy} autonomy`,
      };
      errors.push(issue);
    }
    if (
      (node.permission === "external" ||
        node.permission === "destructive") &&
      !hasGateAncestor(graph.nodes, node)
    ) {
      errors.push({
        code: "MISSING_HUMAN_GATE",
        nodeId: node.id,
        message: `${node.permission} node requires a human_gate ancestor`,
      });
    }
    if (
      node.permission === "external" ||
      node.permission === "destructive"
    ) {
      const byId = new Map(graph.nodes.map((item) => [item.id, item]));
      const unsafeAncestor = [...ancestors(graph.nodes, node.id)]
        .map((id) => byId.get(id))
        .find(
          (ancestor) =>
            ancestor &&
            ancestor.kind !== "human_gate" &&
            PERMISSION_RANK[ancestor.permission] > PERMISSION_RANK.read,
        );
      if (unsafeAncestor) {
        errors.push({
          code: "CONSEQUENTIAL_PREFLIGHT_SIDE_EFFECT",
          nodeId: node.id,
          message: `consequential node has side-effecting pre-gate ancestor ${unsafeAncestor.id}`,
        });
      }
    }
    if (
      node.kind === "parallel_map" &&
      node.permission === "write" &&
      (node.maxConcurrency ?? graph.budgets.maxParallel) > 1
    ) {
      if (node.isolation === "worktree") {
        errors.push({
          code: "UNENFORCED_WORKTREE_ISOLATION",
          nodeId: node.id,
          message:
            "worktree isolation is not implemented by this runtime; set maxConcurrency 1",
        });
      } else {
        errors.push({
          code: "UNISOLATED_PARALLEL_WRITE",
          nodeId: node.id,
          message:
            "parallel write nodes require enforced isolation or maxConcurrency 1",
        });
      }
    }
  }

  for (const node of graph.nodes) {
    for (const dependency of node.dependsOn) {
      if (!ids.has(dependency)) {
        errors.push({
          code: "MISSING_DEPENDENCY",
          nodeId: node.id,
          message: `dependency does not exist: ${dependency}`,
        });
      }
    }
  }

  const topology = topologicalSort(graph.nodes);
  if (topology.cycle) {
    errors.push({
      code: "CYCLE_DETECTED",
      message:
        "arbitrary graph cycles are forbidden; use the bounded repair policy",
    });
  }
  const depth = graphDepth(graph.nodes, topology.order);
  if (depth > graph.budgets.maxDepth) {
    errors.push({
      code: "DEPTH_BUDGET_EXCEEDED",
      message: `graph depth ${depth} exceeds maxDepth ${graph.budgets.maxDepth}`,
    });
  }
  if (graph.budgets.maxRepairRounds < 0 || graph.budgets.maxRepairRounds > 5) {
    errors.push({
      code: "INVALID_REPAIR_BUDGET",
      message: "maxRepairRounds must be between 0 and 5",
    });
  }
  if (graph.budgets.maxFanout < 1 || graph.budgets.maxFanout > 100) {
    errors.push({
      code: "INVALID_FANOUT_BUDGET",
      message: "maxFanout must be between 1 and 100",
    });
  }
  if (graph.budgets.timeoutMs <= 0) {
    errors.push({
      code: "INVALID_TIMEOUT",
      message: "timeoutMs must be positive",
    });
  }
  const estimatedTokens = graph.nodes.reduce((total, node) => {
    const base =
      node.kind === "parallel_map"
        ? 8_000 * graph.budgets.maxFanout
        : node.kind === "agent" || node.kind === "verifier"
          ? 8_000
          : 500;
    return total + base;
  }, 0);
  if (estimatedTokens > graph.budgets.maxEstimatedTokens) {
    errors.push({
      code: "TOKEN_BUDGET_EXCEEDED",
      message: `estimated ${estimatedTokens} tokens exceeds ${graph.budgets.maxEstimatedTokens}`,
    });
  } else if (estimatedTokens > graph.budgets.maxEstimatedTokens * 0.8) {
    warnings.push({
      code: "TOKEN_BUDGET_NEAR_LIMIT",
      message: "estimated token use exceeds 80% of the budget",
    });
  }

  if (graph.repairPolicy?.enabled) {
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    if (!nodeIds.has(graph.repairPolicy.candidateNodeId)) {
      errors.push({
        code: "INVALID_REPAIR_CANDIDATE",
        message: "repair candidate node does not exist",
      });
    }
    if (!nodeIds.has(graph.repairPolicy.verifierNodeId)) {
      errors.push({
        code: "INVALID_REPAIR_VERIFIER",
        message: "repair verifier node does not exist",
      });
    }
    const candidate = graph.nodes.find(
      (node) => node.id === graph.repairPolicy?.candidateNodeId,
    );
    if (
      candidate?.permission === "write" ||
      candidate?.permission === "external" ||
      candidate?.permission === "destructive"
    ) {
      errors.push({
        code: "UNSAFE_SIDE_EFFECTING_REPAIR",
        nodeId: candidate.id,
        message:
          "write, external, and destructive candidates require explicit reconciliation instead of generic automated repair",
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    topologicalOrder: topology.order,
    depth,
    estimatedTokens,
  };
}
