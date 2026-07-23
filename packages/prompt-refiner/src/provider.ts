import {
  assertPermissionPreservation,
  compilePrompt,
  renderEffectivePrompt,
} from "./compiler.js";
import { redactSecrets } from "./security.js";
import type { RefineRequest, RefinementResult } from "./types.js";

type Provider = "openai" | "anthropic";

function providerFromEnvironment(): Provider | undefined {
  const configured = process.env.PROMPT_REFINER_PROVIDER?.toLowerCase();
  if (configured === "openai" || configured === "anthropic") {
    return configured;
  }
  if (configured && configured !== "auto" && configured !== "none") {
    throw new Error(
      "PROMPT_REFINER_PROVIDER must be auto, none, openai, or anthropic",
    );
  }
  if (configured === "none") return undefined;
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return undefined;
}

const SEMANTIC_SYSTEM = `You improve an already-safe execution brief whose sensitive values have already been redacted.
Preserve id, originalPrompt, originalPromptHash, status, classification, risk, permissionsRequired, createdAt, and every explicit constraint.
Do not add goals, permissions, external actions, facts, or credentials.
Improve only brief.context, brief.requirements, brief.constraints, brief.acceptanceCriteria, brief.verification, brief.assumptions, confidence, and warnings.
Return one complete JSON object with exactly the same top-level shape.`;

function parseJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("provider returned no JSON object");
  return JSON.parse(candidate.slice(start, end + 1));
}

function isRefinementResult(value: unknown): value is RefinementResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const brief = record.brief as Record<string, unknown> | undefined;
  const stringArray = (candidate: unknown): candidate is string[] =>
    Array.isArray(candidate) &&
    candidate.every((item) => typeof item === "string");
  return (
    record.version === "1.0" &&
    typeof record.id === "string" &&
    typeof record.originalPrompt === "string" &&
    typeof record.originalPromptHash === "string" &&
    ["ready", "pass_through", "clarification_needed", "confirmation_required"].includes(
      String(record.status),
    ) &&
    [
      "conversation",
      "explanation",
      "implementation",
      "investigation",
      "external_action",
      "destructive_action",
      "other",
    ].includes(String(record.classification)) &&
    ["low", "medium", "high"].includes(String(record.risk)) &&
    typeof record.confidence === "number" &&
    Number.isFinite(record.confidence) &&
    record.confidence >= 0 &&
    record.confidence <= 1 &&
    !!brief &&
    typeof brief.objective === "string" &&
    stringArray(brief.context) &&
    stringArray(brief.requirements) &&
    stringArray(brief.constraints) &&
    stringArray(brief.acceptanceCriteria) &&
    stringArray(brief.verification) &&
    stringArray(brief.assumptions) &&
    stringArray(brief.permissionsRequired) &&
    stringArray(record.warnings) &&
    typeof record.effectivePrompt === "string" &&
    ["deterministic", "openai", "anthropic"].includes(
      String(record.provider),
    ) &&
    typeof record.createdAt === "string"
  );
}

function semanticProjection(draft: RefinementResult): RefinementResult {
  const serialized = JSON.stringify(draft);
  const redacted = redactSecrets(serialized).text;
  return JSON.parse(redacted) as RefinementResult;
}

function includesEvery(expected: string[], candidate: string[]): boolean {
  return expected.every((item) => candidate.includes(item));
}

function assertSemanticPreservation(
  draft: RefinementResult,
  projection: RefinementResult,
  parsed: RefinementResult,
): void {
  if (
    parsed.id !== projection.id ||
    parsed.originalPrompt !== projection.originalPrompt ||
    parsed.originalPromptHash !== projection.originalPromptHash ||
    parsed.status !== projection.status ||
    parsed.classification !== projection.classification ||
    parsed.risk !== projection.risk ||
    parsed.createdAt !== projection.createdAt ||
    parsed.brief.objective !== projection.brief.objective ||
    parsed.clarificationQuestion !== projection.clarificationQuestion ||
    parsed.confirmationReason !== projection.confirmationReason
  ) {
    throw new Error("semantic refinement changed protected intent fields");
  }
  assertPermissionPreservation(draft, parsed);
  for (const [label, expected, candidate] of [
    ["requirements", draft.brief.requirements, parsed.brief.requirements],
    ["constraints", draft.brief.constraints, parsed.brief.constraints],
    [
      "acceptance criteria",
      draft.brief.acceptanceCriteria,
      parsed.brief.acceptanceCriteria,
    ],
    ["verification", draft.brief.verification, parsed.brief.verification],
  ] as const) {
    if (!includesEvery(expected, candidate)) {
      throw new Error(`semantic refinement removed required ${label}`);
    }
  }
}

function openAIText(payload: unknown): string {
  const output = (payload as { output?: unknown[] }).output;
  if (!Array.isArray(output)) return "";
  return output
    .flatMap((item) => {
      const content = (item as { content?: unknown[] }).content;
      return Array.isArray(content) ? content : [];
    })
    .map((item) => {
      const record = item as { text?: string };
      return record.text ?? "";
    })
    .join("");
}

async function callOpenAI(
  draft: RefinementResult,
  signal: AbortSignal,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.PROMPT_REFINER_MODEL;
  if (!apiKey || !model) {
    throw new Error(
      "OPENAI_API_KEY and PROMPT_REFINER_MODEL are required for OpenAI semantic refinement",
    );
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: SEMANTIC_SYSTEM,
      input: JSON.stringify(draft),
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI request failed with HTTP ${response.status}`);
  }
  return openAIText(await response.json());
}

async function callAnthropic(
  draft: RefinementResult,
  signal: AbortSignal,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.PROMPT_REFINER_MODEL;
  if (!apiKey || !model) {
    throw new Error(
      "ANTHROPIC_API_KEY and PROMPT_REFINER_MODEL are required for Anthropic semantic refinement",
    );
  }
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 3000,
      system: SEMANTIC_SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(draft) }],
    }),
  });
  if (!response.ok) {
    throw new Error(`Anthropic request failed with HTTP ${response.status}`);
  }
  const payload = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  return (
    payload.content
      ?.filter((item) => item.type === "text")
      .map((item) => item.text ?? "")
      .join("") ?? ""
  );
}

export async function refinePrompt(
  request: RefineRequest,
): Promise<RefinementResult> {
  const draft = compilePrompt(request);
  if (!request.semantic || draft.status !== "ready") return draft;

  let provider: Provider | undefined;
  try {
    provider = providerFromEnvironment();
  } catch (error) {
    return {
      ...draft,
      warnings: [...draft.warnings, (error as Error).message],
    };
  }
  if (!provider) return draft;

  const timeoutMs = Number(process.env.PROMPT_REFINER_TIMEOUT_MS ?? "8000");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const projection = semanticProjection(draft);
    const text =
      provider === "openai"
        ? await callOpenAI(projection, controller.signal)
        : await callAnthropic(projection, controller.signal);
    const parsed = parseJsonObject(text);
    if (!isRefinementResult(parsed)) {
      throw new Error("provider response failed refinement schema validation");
    }
    assertSemanticPreservation(draft, projection, parsed);
    const brief = {
      ...parsed.brief,
      objective: draft.brief.objective,
      permissionsRequired: draft.brief.permissionsRequired,
    };
    const warnings = [...new Set([...draft.warnings, ...parsed.warnings])];
    const protectedResult: Omit<RefinementResult, "effectivePrompt"> = {
      ...parsed,
      id: draft.id,
      originalPrompt: draft.originalPrompt,
      originalPromptHash: draft.originalPromptHash,
      status: draft.status,
      classification: draft.classification,
      risk: draft.risk,
      brief,
      ...(draft.clarificationQuestion
        ? { clarificationQuestion: draft.clarificationQuestion }
        : {}),
      ...(draft.confirmationReason
        ? { confirmationReason: draft.confirmationReason }
        : {}),
      warnings,
      provider,
      createdAt: draft.createdAt,
    };
    return {
      ...protectedResult,
      effectivePrompt: renderEffectivePrompt(
        draft.brief.objective,
        protectedResult,
      ),
    };
  } catch (error) {
    return {
      ...draft,
      warnings: [
        ...draft.warnings,
        `Semantic refinement failed safely: ${(error as Error).message}`,
      ],
    };
  } finally {
    clearTimeout(timeout);
  }
}
