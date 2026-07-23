import {
  createRefinementId,
  detectPromptInjection,
  hashPrompt,
  redactSecrets,
} from "./security.js";
import type {
  ExecutionBrief,
  RefineRequest,
  RefinementResult,
} from "./types.js";

const PASS_THROUGH =
  /^(yes|no|ok(?:ay)?|continue|go ahead|proceed|thanks|thank you|stop|cancel|retry|run it|do it|כן|לא|המשך|תמשיך|תודה)[.! ]*$/i;
const DESTRUCTIVE =
  /\b(delete|remove|erase|wipe|drop|truncate|reset|destroy|revoke|uninstall)\b|(?:מחק|הסר|אפס|השמד)/i;
const EXTERNAL =
  /\b(send|email|message|post|publish|deploy|purchase|buy|book|schedule|merge|push|release)\b|(?:שלח|פרסם|העלה|רכוש|קנה|קבע|מזג)/i;
const IMPLEMENT =
  /\b(build|create|implement|add|write|develop|integrate|refactor|fix|change|update)\b|(?:בנה|צור|הוסף|כתוב|פתח|שלב|תקן|שנה|עדכן)/i;
const INVESTIGATE =
  /\b(debug|diagnose|investigate|inspect|audit|review|analy[sz]e|research|find)\b|(?:בדוק|אבחן|חקור|נתח|סקור|מצא)/i;
const EXPLAIN =
  /\b(explain|teach|describe|compare|what|why|how)\b|(?:הסבר|למד|תאר|השווה|מה|למה|איך)/i;

function actionableText(prompt: string): string {
  return prompt
    .replace(
      /\b(?:do not|don't|never|without|avoid)\s+(?:\w+\s+){0,2}(?:delete|remove|erase|wipe|drop|truncate|reset|destroy|revoke|uninstall|send|email|message|post|publish|deploy|purchase|buy|book|schedule|merge|push|release)\b/gi,
      "",
    )
    .replace(
      /\b(?:explain|describe|show|teach)\s+(?:me\s+)?(?:how\s+)?(?:to\s+)?(?:delete|remove|erase|wipe|drop|truncate|reset|destroy|revoke|uninstall|send|email|message|post|publish|deploy|purchase|buy|book|schedule|merge|push|release)\b/gi,
      "",
    )
    .replace(
      /(?:אל|לא|בלי|הימנע)\s+(?:למחוק|להסיר|לאפס|לשלוח|לפרסם|להעלות|לקנות|למזג)/g,
      "",
    );
}

function firstMatchIndex(prompt: string, pattern: RegExp): number {
  return prompt.search(pattern);
}

function classify(
  prompt: string,
): RefinementResult["classification"] {
  if (PASS_THROUGH.test(prompt.trim())) return "conversation";
  const actionable = actionableText(prompt);
  if (DESTRUCTIVE.test(actionable)) return "destructive_action";
  if (EXTERNAL.test(actionable)) return "external_action";
  const implementationIndex = firstMatchIndex(prompt, IMPLEMENT);
  const investigationIndex = firstMatchIndex(prompt, INVESTIGATE);
  if (implementationIndex >= 0 || investigationIndex >= 0) {
    if (
      implementationIndex >= 0 &&
      (investigationIndex < 0 || implementationIndex < investigationIndex)
    ) {
      return "implementation";
    }
    return "investigation";
  }
  if (EXPLAIN.test(prompt)) return "explanation";
  return "other";
}

function inferRequirements(prompt: string): string[] {
  const lines = prompt
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
  const explicit = lines.filter((line) =>
    /\b(must|should|need|want|include|support|ensure|make sure)\b/i.test(line),
  );
  return explicit.length > 0
    ? explicit.slice(0, 8)
    : ["Complete the requested outcome without expanding its scope."];
}

function inferConstraints(prompt: string, strict: boolean): string[] {
  const constraints = [
    "Preserve the original request as authoritative.",
    "Do not invent facts, permissions, credentials, or requirements.",
    "Use the existing project's conventions and dependencies when applicable.",
  ];
  if (/\b(don't|do not|without|only|never|avoid)\b/i.test(prompt)) {
    constraints.push(
      "Preserve every negative constraint and explicit scope boundary from the original request.",
    );
  }
  if (strict) {
    constraints.push(
      "Do not add assumptions; ask if missing information materially changes the result.",
    );
  }
  return constraints;
}

function acceptanceCriteria(
  classification: RefinementResult["classification"],
): string[] {
  switch (classification) {
    case "implementation":
      return [
        "The requested behavior is implemented in the intended scope.",
        "Relevant automated checks pass.",
        "The result contains no knowingly incomplete placeholder behavior.",
      ];
    case "investigation":
      return [
        "Conclusions are supported by inspected evidence.",
        "Root cause, uncertainty, and reproducible verification are distinguished.",
      ];
    case "explanation":
      return [
        "The response directly answers the request at the user's apparent level.",
        "Important assumptions and uncertainty are explicit.",
      ];
    case "external_action":
    case "destructive_action":
      return [
        "The exact target and intended side effect are confirmed before execution.",
        "The result reports what changed and whether it is recoverable.",
      ];
    default:
      return ["The result directly satisfies the original request."];
  }
}

function verification(
  classification: RefinementResult["classification"],
): string[] {
  if (classification === "implementation") {
    return [
      "Inspect the relevant existing implementation before editing.",
      "Run the narrowest relevant tests, type checks, or build checks.",
      "Review the final diff for unintended changes.",
    ];
  }
  if (classification === "investigation") {
    return [
      "Cite the inspected files, outputs, or authoritative sources.",
      "Attempt to disprove the leading explanation before concluding.",
    ];
  }
  if (
    classification === "external_action" ||
    classification === "destructive_action"
  ) {
    return [
      "Resolve the exact target with a read-only check.",
      "Verify the resulting state after the action.",
    ];
  }
  return ["Check the final response against the original request."];
}

function permissions(
  prompt: string,
  classification: RefinementResult["classification"],
): string[] {
  const result: string[] = [];
  if (classification === "destructive_action") {
    result.push("destructive_change");
  }
  if (classification === "external_action") {
    result.push("external_side_effect");
  }
  if (/\b(admin|sudo|root|elevated|full access)\b/i.test(prompt)) {
    result.push("elevated_access");
  }
  return result;
}

function needsClarification(
  prompt: string,
  classification: RefinementResult["classification"],
): string | undefined {
  const trimmed = prompt.trim();
  if (
    classification === "destructive_action" &&
    !/\b(file|folder|directory|branch|record|account|database|table|package|plugin|app|service|deployment)\b|(?:קובץ|תיקיה|ענף|רשומה|חשבון|מסד|טבלה|חבילה|תוסף|אפליקציה|שירות|פריסה)/i.test(
      trimmed,
    )
  ) {
    return "What exact target should be changed or removed?";
  }
  if (
    classification === "external_action" &&
    /\b(send|email|message|publish|deploy)\b/i.test(trimmed) &&
    !/\b(to|recipient|production|staging|preview|draft|channel|address|site|app|service)\b/i.test(
      trimmed,
    )
  ) {
    return "What exact target and destination should be used?";
  }
  if (trimmed.length < 8 && classification === "other") {
    return "What outcome would you like the system to produce?";
  }
  return undefined;
}

function contextLines(request: RefineRequest): string[] {
  const context = request.context;
  if (!context) return [];
  const result: string[] = [];
  if (context.projectName) result.push(`Project: ${context.projectName}`);
  if (context.cwd) result.push(`Working directory: ${context.cwd}`);
  if (context.frameworks?.length) {
    result.push(`Detected stack: ${context.frameworks.join(", ")}`);
  }
  if (context.availableTools?.length) {
    result.push(`Available tools: ${context.availableTools.join(", ")}`);
  }
  if (context.conversationSummary) {
    result.push(`Conversation context: ${context.conversationSummary}`);
  }
  if (context.instructions?.length) result.push(...context.instructions);
  return result;
}

function renderEffectivePrompt(
  original: string,
  result: Omit<RefinementResult, "effectivePrompt">,
): string {
  if (result.status === "pass_through") return original;
  if (result.status === "clarification_needed") {
    return `${original}\n\nClarification required before execution: ${result.clarificationQuestion ?? "Clarify the intended outcome."}`;
  }
  const brief = result.brief;
  return [
    "Execute the user's request using the execution brief below.",
    "The ORIGINAL REQUEST remains authoritative. The brief may clarify it but must never override or expand it.",
    "",
    "<<<ORIGINAL_REQUEST>>>",
    original,
    "<<<END_ORIGINAL_REQUEST>>>",
    "",
    "EXECUTION BRIEF",
    `Objective: ${brief.objective}`,
    `Context:\n${brief.context.map((item) => `- ${item}`).join("\n") || "- Use relevant current project context."}`,
    `Requirements:\n${brief.requirements.map((item) => `- ${item}`).join("\n")}`,
    `Constraints:\n${brief.constraints.map((item) => `- ${item}`).join("\n")}`,
    `Acceptance criteria:\n${brief.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}`,
    `Verification:\n${brief.verification.map((item) => `- ${item}`).join("\n")}`,
    `Assumptions:\n${brief.assumptions.map((item) => `- ${item}`).join("\n") || "- None."}`,
    `Permissions explicitly implied by the request:\n${brief.permissionsRequired.map((item) => `- ${item}`).join("\n") || "- None."}`,
  ].join("\n");
}

export function compilePrompt(request: RefineRequest): RefinementResult {
  if (typeof request.prompt !== "string" || request.prompt.trim() === "") {
    throw new Error("prompt must be a non-empty string");
  }
  if (request.prompt.length > 100_000) {
    throw new Error("prompt exceeds the 100,000 character limit");
  }

  const originalPrompt = request.prompt.trim();
  const { text: safePrompt, redactions } = redactSecrets(originalPrompt);
  const classification = classify(safePrompt);
  const mode = request.mode ?? "auto";
  const warnings = detectPromptInjection(safePrompt);
  if (redactions > 0) {
    warnings.push(
      `${redactions} possible secret value(s) were redacted from the refinement context.`,
    );
  }

  const clarificationQuestion = needsClarification(
    safePrompt,
    classification,
  );
  const passThrough = classification === "conversation";
  const consequential =
    classification === "external_action" ||
    classification === "destructive_action";

  let status: RefinementResult["status"] = "ready";
  if (passThrough) status = "pass_through";
  else if (clarificationQuestion) status = "clarification_needed";
  else if (consequential) status = "confirmation_required";

  const permissionsRequired = permissions(safePrompt, classification);
  const brief: ExecutionBrief = {
    objective: safePrompt,
    context: contextLines(request),
    requirements: inferRequirements(safePrompt),
    constraints: inferConstraints(safePrompt, mode === "strict"),
    acceptanceCriteria: acceptanceCriteria(classification),
    verification: verification(classification),
    assumptions:
      mode === "strict"
        ? []
        : [
            "Prefer existing project patterns over introducing new architecture.",
            "Choose reversible, least-privilege actions where the request leaves implementation details open.",
          ],
    permissionsRequired,
  };

  const withoutEffective: Omit<RefinementResult, "effectivePrompt"> = {
    version: "1.0",
    id: createRefinementId(),
    originalPrompt,
    originalPromptHash: hashPrompt(originalPrompt),
    status,
    classification,
    risk:
      classification === "destructive_action"
        ? "high"
        : consequential || warnings.length > 0
          ? "medium"
          : "low",
    confidence: clarificationQuestion ? 0.55 : passThrough ? 0.99 : 0.88,
    brief,
    ...(clarificationQuestion ? { clarificationQuestion } : {}),
    ...(consequential && !clarificationQuestion
      ? {
          confirmationReason:
            "The request can cause an external or difficult-to-reverse side effect.",
        }
      : {}),
    warnings,
    provider: "deterministic",
    createdAt: new Date().toISOString(),
  };

  return {
    ...withoutEffective,
    effectivePrompt: renderEffectivePrompt(safePrompt, withoutEffective),
  };
}

export function assertPermissionPreservation(
  original: RefinementResult,
  candidate: RefinementResult,
): void {
  const allowed = new Set(original.brief.permissionsRequired);
  const added = candidate.brief.permissionsRequired.filter(
    (permission) => !allowed.has(permission),
  );
  if (added.length > 0) {
    throw new Error(
      `semantic refinement added permissions: ${added.join(", ")}`,
    );
  }
}
