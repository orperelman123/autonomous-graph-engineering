export type RefinementMode = "auto" | "silent" | "visible" | "strict";
export type RefinementStatus =
  | "ready"
  | "pass_through"
  | "clarification_needed"
  | "confirmation_required";
export type RiskLevel = "low" | "medium" | "high";

export interface PromptContext {
  cwd?: string;
  projectName?: string;
  frameworks?: string[];
  availableTools?: string[];
  conversationSummary?: string;
  instructions?: string[];
}

export interface RefineRequest {
  prompt: string;
  mode?: RefinementMode;
  context?: PromptContext;
  semantic?: boolean;
}

export interface ExecutionBrief {
  objective: string;
  context: string[];
  requirements: string[];
  constraints: string[];
  acceptanceCriteria: string[];
  verification: string[];
  assumptions: string[];
  permissionsRequired: string[];
}

export interface RefinementResult {
  version: "1.0";
  id: string;
  originalPrompt: string;
  originalPromptHash: string;
  status: RefinementStatus;
  classification:
    | "conversation"
    | "explanation"
    | "implementation"
    | "investigation"
    | "external_action"
    | "destructive_action"
    | "other";
  risk: RiskLevel;
  confidence: number;
  brief: ExecutionBrief;
  clarificationQuestion?: string;
  confirmationReason?: string;
  warnings: string[];
  effectivePrompt: string;
  provider: "deterministic" | "openai" | "anthropic";
  createdAt: string;
}

export interface EvaluationCase {
  id: string;
  prompt: string;
  expectedStatus: RefinementStatus;
  expectedClassification?: RefinementResult["classification"];
  mustNotRequestPermissions?: string[];
  mustContain?: string[];
}

export interface EvaluationReport {
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
