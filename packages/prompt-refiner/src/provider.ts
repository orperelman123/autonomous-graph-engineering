import {
  assertPermissionPreservation,
  compilePrompt,
} from "./compiler.js";
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

const SEMANTIC_SYSTEM = `You improve an already-safe execution brief.
Preserve originalPrompt, originalPromptHash, status, classification, risk, permissionsRequired, and every explicit constraint.
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
  return (
    record.version === "1.0" &&
    typeof record.originalPrompt === "string" &&
    typeof record.originalPromptHash === "string" &&
    typeof record.status === "string" &&
    typeof record.classification === "string" &&
    typeof record.brief === "object" &&
    typeof record.effectivePrompt === "string"
  );
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
    const text =
      provider === "openai"
        ? await callOpenAI(draft, controller.signal)
        : await callAnthropic(draft, controller.signal);
    const parsed = parseJsonObject(text);
    if (!isRefinementResult(parsed)) {
      throw new Error("provider response failed refinement schema validation");
    }
    if (
      parsed.originalPrompt !== draft.originalPrompt ||
      parsed.originalPromptHash !== draft.originalPromptHash ||
      parsed.status !== draft.status ||
      parsed.classification !== draft.classification
    ) {
      throw new Error("semantic refinement changed protected intent fields");
    }
    assertPermissionPreservation(draft, parsed);
    return { ...parsed, provider };
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
