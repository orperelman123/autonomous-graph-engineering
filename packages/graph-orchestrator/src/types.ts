import type { RefinementResult } from "@autonomous-graph-engineering/prompt-refiner";

export type AutonomyLevel =
  | "plan_only"
  | "read_only"
  | "workspace"
  | "consequential";

export type GraphNodeKind =
  | "deterministic"
  | "agent"
  | "parallel_map"
  | "reduce"
  | "verifier"
  | "human_gate";

export type NodePermission =
  | "none"
  | "read"
  | "write"
  | "external"
  | "destructive";

export type NodeState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "skipped";

export interface GraphBudgets {
  maxNodes: number;
  maxParallel: number;
  maxFanout: number;
  maxDepth: number;
  maxRepairRounds: number;
  timeoutMs: number;
  maxEstimatedTokens: number;
  maxActualTokens?: number;
}
export interface GraphNode {
  id: string;
  label: string;
  kind: GraphNodeKind;
  dependsOn: string[];
  permission: NodePermission;
  executor?: "codex" | "claude" | "local";
  prompt?: string;
  operation?: "identity" | "collect" | "flatten" | "dedupe";
  inputPath?: string;
  maxConcurrency?: number;
  outputSchema?: Record<string, unknown>;
  isolation?: "shared" | "worktree";
  metadata?: Record<string, unknown>;
}

export interface RepairPolicy {
  enabled: boolean;
  candidateNodeId: string;
  verifierNodeId: string;
  acceptedField: string;
  repairExecutor: "codex" | "claude" | "local";
  repairPrompt: string;
}

export interface GraphSpec {
  version: "1.0";
  id: string;
  goal: string;
  originalPromptHash: string;
  autonomy: AutonomyLevel;
  createdAt: string;
  budgets: GraphBudgets;
  nodes: GraphNode[];
  repairPolicy?: RepairPolicy;
  metadata: {
    routing: "direct" | "graph" | "human_gate";
    complexityScore: number;
    planner: "deterministic" | "semantic";
    refinement: RefinementResult;
  };
}

export interface ValidationIssue {
  code: string;
  message: string;
  nodeId?: string;
}

export interface GraphValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  topologicalOrder: string[];
  depth: number;
  estimatedTokens: number;
}

export interface AgentExecutionRequest {
  runId: string;
  nodeId: string;
  label: string;
  prompt: string;
  permission: NodePermission;
  input: unknown;
  outputSchema?: Record<string, unknown>;
  cwd: string;
  timeoutMs: number;
  idempotencyKey?: string;
  attemptId?: string;
  iteration?: number;
  signal?: AbortSignal;
}

export interface AgentExecutionResult {
  output: unknown;
  usage?: TokenUsage;
}

export interface TokenUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  costUsd?: number;
}

export interface GraphExecutor {
  name: string;
  execute(request: AgentExecutionRequest): Promise<AgentExecutionResult>;
}

export interface GraphRunEvent {
  sequence: number;
  runId: string;
  timestamp: string;
  type:
    | "run_started"
    | "run_resumed"
    | "run_completed"
    | "run_failed"
    | "run_blocked"
    | "node_started"
    | "node_completed"
    | "node_failed"
    | "node_blocked"
    | "node_reconciled"
    | "repair_started"
    | "repair_completed";
  nodeId?: string;
  data?: Record<string, unknown>;
}

export interface NodeRunResult {
  nodeId: string;
  state: NodeState;
  output?: unknown;
  error?: string;
  failureKind?: "timeout" | "budget" | "executor";
  idempotencyKey?: string;
  attemptId?: string;
  startedAt?: string;
  completedAt?: string;
  usage?: TokenUsage;
}

export interface GraphRunResult {
  runId: string;
  graphId: string;
  status:
    | "completed"
    | "failed"
    | "needs_confirmation"
    | "plan_only";
  outputs: Record<string, unknown>;
  nodes: Record<string, NodeRunResult>;
  repairRounds: number;
  usage: TokenUsage;
  startedAt: string;
  completedAt: string;
  auditPath?: string;
  checkpointPath?: string;
  error?: string;
  confirmation?: {
    gateId: string;
    approvalToken: string;
  };
}

export interface GraphRunCheckpoint {
  version: "1.0";
  graph: GraphSpec;
  graphHash: string;
  runId: string;
  status: "running" | "completed" | "failed" | "needs_confirmation";
  outputs: Record<string, unknown>;
  nodes: Record<string, NodeRunResult>;
  repairRounds: number;
  usage: TokenUsage;
  startedAt: string;
  updatedAt: string;
  eventSequence: number;
  reconciliations?: ReconciliationRecord[];
}

export interface TerminationEvidence {
  attemptId: string;
  executor: string;
  observedAt: string;
  method: string;
  status: "terminated";
}

export interface ReconciliationRecord {
  nodeId: string;
  outcome: "completed" | "not_applied";
  evidence: string;
  token: string;
  idempotencyKey?: string;
  terminationEvidence?: TerminationEvidence;
  createdAt: string;
}

export interface PlanGraphRequest {
  prompt: string;
  autonomy?: AutonomyLevel;
  primaryExecutor?: "codex" | "claude" | "local";
  verifierExecutor?: "codex" | "claude" | "local";
  forceGraph?: boolean;
}

export interface RunGraphOptions {
  cwd?: string;
  executors: Partial<Record<"codex" | "claude" | "local", GraphExecutor>>;
  approvals?: string[];
  auditDirectory?: string;
  now?: () => Date;
  resume?: GraphRunCheckpoint;
}

export interface GraphEvaluationReport {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  durationMs: number;
  results: Array<{
    id: string;
    passed: boolean;
    failures: string[];
  }>;
}
