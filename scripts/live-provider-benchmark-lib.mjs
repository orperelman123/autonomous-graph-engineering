import { createHash } from "node:crypto";

const PROVIDERS = new Set(["openai", "anthropic"]);
const PLACEHOLDER = /(replace|placeholder|your[-_ ]?model|model[-_ ]?id)/i;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function finiteNumber(value, name, { positive = false } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
  if (positive ? value <= 0 : value < 0) {
    throw new Error(`${name} must be ${positive ? "positive" : "non-negative"}`);
  }
  return value;
}

function integer(value, name, minimum, maximum) {
  if (
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function text(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function exactKeys(value, name, allowed) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new Error(`${name} contains unsupported fields: ${unknown.join(", ")}`);
  }
}

function roundUsd(value) {
  return Math.round((value + Number.EPSILON) * 1e8) / 1e8;
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function requestUpperBound(provider, plan) {
  const rates = provider.pricingUsdPerMillionTokens;
  const worstInputRate = Math.max(
    rates.input,
    rates.cachedInput,
    rates.cacheCreationInput,
  );
  return (
    (plan.maxInputTokensPerRequest * worstInputRate +
      plan.maxOutputTokensPerRequest * rates.output) /
    1_000_000
  );
}

export function validateLiveBenchmarkPlan(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("plan must be an object");
  }
  const plan = structuredClone(value);
  exactKeys(plan, "plan", [
    "version",
    "id",
    "budgetUsd",
    "repetitions",
    "timeoutMs",
    "maxInputTokensPerRequest",
    "maxOutputTokensPerRequest",
    "providers",
    "tasks",
  ]);
  if (plan.version !== "1.0") throw new Error("version must be 1.0");
  text(plan.id, "id");
  finiteNumber(plan.budgetUsd, "budgetUsd", { positive: true });
  integer(plan.repetitions, "repetitions", 1, 10);
  integer(plan.timeoutMs, "timeoutMs", 1_000, 120_000);
  integer(
    plan.maxInputTokensPerRequest,
    "maxInputTokensPerRequest",
    256,
    1_000_000,
  );
  integer(
    plan.maxOutputTokensPerRequest,
    "maxOutputTokensPerRequest",
    1,
    100_000,
  );
  if (!Array.isArray(plan.tasks) || plan.tasks.length < 1 || plan.tasks.length > 50) {
    throw new Error("tasks must contain 1 to 50 entries");
  }
  const taskIds = new Set();
  for (const [index, task] of plan.tasks.entries()) {
    if (!task || typeof task !== "object" || Array.isArray(task)) {
      throw new Error(`tasks[${index}] must be an object`);
    }
    exactKeys(task, `tasks[${index}]`, ["id", "prompt", "requiredPhrases"]);
    text(task?.id, `tasks[${index}].id`);
    text(task?.prompt, `tasks[${index}].prompt`);
    if (taskIds.has(task.id)) throw new Error(`duplicate task id: ${task.id}`);
    taskIds.add(task.id);
    if (
      !Array.isArray(task.requiredPhrases) ||
      task.requiredPhrases.length < 1 ||
      task.requiredPhrases.some((phrase) => typeof phrase !== "string" || !phrase)
    ) {
      throw new Error(`tasks[${index}].requiredPhrases must be non-empty strings`);
    }
    const conservativeInputCeiling =
      Buffer.byteLength(task.prompt, "utf8") + 512;
    if (conservativeInputCeiling > plan.maxInputTokensPerRequest) {
      throw new Error(
        `task ${task.id} needs maxInputTokensPerRequest >= ${conservativeInputCeiling}`,
      );
    }
  }
  if (
    !Array.isArray(plan.providers) ||
    plan.providers.length < 1 ||
    plan.providers.length > 4
  ) {
    throw new Error("providers must contain 1 to 4 entries");
  }
  const providerKeys = new Set();
  for (const [index, provider] of plan.providers.entries()) {
    if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
      throw new Error(`providers[${index}] must be an object`);
    }
    exactKeys(provider, `providers[${index}]`, [
      "provider",
      "model",
      "apiKeyEnv",
      "pricingUsdPerMillionTokens",
    ]);
    if (!PROVIDERS.has(provider?.provider)) {
      throw new Error(`providers[${index}].provider is unsupported`);
    }
    text(provider.model, `providers[${index}].model`);
    if (PLACEHOLDER.test(provider.model)) {
      throw new Error(`providers[${index}].model must be an exact model id`);
    }
    const expectedKey =
      provider.provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
    if (provider.apiKeyEnv !== expectedKey) {
      throw new Error(
        `providers[${index}].apiKeyEnv must be ${expectedKey}`,
      );
    }
    const key = `${provider.provider}:${provider.model}`;
    if (providerKeys.has(key)) throw new Error(`duplicate provider model: ${key}`);
    providerKeys.add(key);
    const rates = provider.pricingUsdPerMillionTokens;
    if (!rates || typeof rates !== "object") {
      throw new Error(`providers[${index}].pricingUsdPerMillionTokens is required`);
    }
    exactKeys(rates, `providers[${index}].pricingUsdPerMillionTokens`, [
      "input",
      "cachedInput",
      "cacheCreationInput",
      "output",
    ]);
    for (const field of [
      "input",
      "cachedInput",
      "cacheCreationInput",
      "output",
    ]) {
      finiteNumber(
        rates[field],
        `providers[${index}].pricingUsdPerMillionTokens.${field}`,
      );
    }
    if (rates.input === 0 || rates.output === 0) {
      throw new Error(`providers[${index}] input and output rates must be positive`);
    }
  }

  const requestCount =
    plan.tasks.length * plan.providers.length * plan.repetitions;
  const rawMaximumCostUsd = plan.providers.reduce(
    (sum, provider) =>
      sum +
      requestUpperBound(provider, plan) *
        plan.tasks.length *
        plan.repetitions,
    0,
  );
  const maximumCostUsd = roundUsd(rawMaximumCostUsd);
  if (rawMaximumCostUsd > plan.budgetUsd) {
    throw new Error(
      `declared maximum cost $${maximumCostUsd} exceeds budgetUsd $${plan.budgetUsd}`,
    );
  }
  const canonical = canonicalJson(plan);
  return {
    plan,
    planSha256: createHash("sha256").update(canonical).digest("hex"),
    requestCount,
    maximumCostUsd,
  };
}

function outputText(provider, body) {
  if (provider === "openai") {
    return (body.output ?? [])
      .flatMap((item) => item.content ?? [])
      .filter((item) => item.type === "output_text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("\n");
  }
  return (body.content ?? [])
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

function normalizedUsage(provider, body) {
  const usage = body.usage ?? {};
  const tokenCount = (value, field) => {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`provider returned invalid ${field}`);
    }
    return value;
  };
  if (provider === "openai") {
    const normalized = {
      inputTokens: tokenCount(usage.input_tokens, "input_tokens"),
      cachedInputTokens: tokenCount(
        usage.input_tokens_details?.cached_tokens ?? 0,
        "cached_tokens",
      ),
      cacheCreationInputTokens: 0,
      outputTokens: tokenCount(usage.output_tokens, "output_tokens"),
    };
    if (normalized.cachedInputTokens > normalized.inputTokens) {
      throw new Error("provider returned cached_tokens above input_tokens");
    }
    return normalized;
  }
  return {
    inputTokens: tokenCount(usage.input_tokens, "input_tokens"),
    cachedInputTokens: tokenCount(
      usage.cache_read_input_tokens ?? 0,
      "cache_read_input_tokens",
    ),
    cacheCreationInputTokens: tokenCount(
      usage.cache_creation_input_tokens ?? 0,
      "cache_creation_input_tokens",
    ),
    outputTokens: tokenCount(usage.output_tokens, "output_tokens"),
  };
}

function usageCost(provider, usage, rates) {
  const ordinaryInput =
    provider === "openai"
      ? Math.max(0, usage.inputTokens - usage.cachedInputTokens)
      : usage.inputTokens;
  return (
    (ordinaryInput * rates.input +
      usage.cachedInputTokens * rates.cachedInput +
      usage.cacheCreationInputTokens * rates.cacheCreationInput +
      usage.outputTokens * rates.output) /
    1_000_000
  );
}

async function boundedJson(response) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error(`provider response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  const raw = await response.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BYTES) {
    throw new Error(`provider response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("provider returned invalid JSON");
  }
}

async function providerRequest(provider, task, plan, apiKey, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), plan.timeoutMs);
  try {
    const openai = provider.provider === "openai";
    const response = await fetchImpl(
      openai
        ? "https://api.openai.com/v1/responses"
        : "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: openai
          ? {
              authorization: `Bearer ${apiKey}`,
              "content-type": "application/json",
            }
          : {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
            },
        body: JSON.stringify(
          openai
            ? {
                model: provider.model,
                input: task.prompt,
                max_output_tokens: plan.maxOutputTokensPerRequest,
                store: false,
              }
            : {
                model: provider.model,
                max_tokens: plan.maxOutputTokensPerRequest,
                messages: [{ role: "user", content: task.prompt }],
              },
        ),
        signal: controller.signal,
      },
    );
    const body = await boundedJson(response);
    if (!response.ok) {
      throw new Error(
        `${provider.provider} request failed with HTTP ${response.status}: ${
          typeof body.error?.message === "string"
            ? body.error.message.slice(0, 300)
            : "no provider message"
        }`,
      );
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

export async function runLiveBenchmark({
  plan: rawPlan,
  execute = false,
  confirmedBudgetUsd,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
}) {
  const validated = validateLiveBenchmarkPlan(rawPlan);
  const base = {
    version: "1.0",
    benchmark: "live-provider-outcome",
    mode: execute ? "live" : "dry_run",
    planId: validated.plan.id,
    planSha256: validated.planSha256,
    budgetUsd: validated.plan.budgetUsd,
    maximumCostUsd: validated.maximumCostUsd,
    requestCount: validated.requestCount,
  };
  if (!execute) {
    return { ...base, status: "ready", costUsd: 0, results: [] };
  }
  if (
    typeof confirmedBudgetUsd !== "number" ||
    confirmedBudgetUsd !== validated.plan.budgetUsd
  ) {
    throw new Error(
      `--confirm-budget-usd must exactly equal ${validated.plan.budgetUsd}`,
    );
  }
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
  for (const provider of validated.plan.providers) {
    if (!env[provider.apiKeyEnv]) {
      throw new Error(`${provider.apiKeyEnv} is required for live execution`);
    }
  }

  const startedAt = now().toISOString();
  const results = [];
  let rawCostUsd = 0;
  let status = "completed";
  let accountingComplete = true;
  outer: for (const provider of validated.plan.providers) {
    for (const task of validated.plan.tasks) {
      for (let repetition = 1; repetition <= validated.plan.repetitions; repetition += 1) {
        try {
          const body = await providerRequest(
            provider,
            task,
            validated.plan,
            env[provider.apiKeyEnv],
            fetchImpl,
          );
          const usage = normalizedUsage(provider.provider, body);
          const totalInput =
            usage.inputTokens +
            (provider.provider === "anthropic"
              ? usage.cachedInputTokens + usage.cacheCreationInputTokens
              : 0);
          const rawResultCost = usageCost(
            provider.provider,
            usage,
            provider.pricingUsdPerMillionTokens,
          );
          rawCostUsd += rawResultCost;
          const responseText = outputText(provider.provider, body);
          const passed = task.requiredPhrases.every((phrase) =>
            responseText.toLocaleLowerCase().includes(phrase.toLocaleLowerCase()),
          );
          const violations = [];
          if (totalInput > validated.plan.maxInputTokensPerRequest) {
            violations.push("actual input tokens exceeded the preregistered ceiling");
          }
          if (usage.outputTokens > validated.plan.maxOutputTokensPerRequest) {
            violations.push("actual output tokens exceeded the preregistered ceiling");
          }
          if (rawCostUsd > validated.plan.budgetUsd) {
            violations.push("actual accounted cost exceeded budgetUsd");
          }
          results.push({
            provider: provider.provider,
            model: provider.model,
            taskId: task.id,
            repetition,
            passed: passed && violations.length === 0,
            requiredPhrases: task.requiredPhrases,
            responseText,
            usage,
            costUsd: roundUsd(rawResultCost),
            violations,
          });
          if (violations.length > 0) {
            status = "failed";
            break outer;
          }
        } catch (error) {
          status = "failed";
          accountingComplete = false;
          results.push({
            provider: provider.provider,
            model: provider.model,
            taskId: task.id,
            repetition,
            passed: false,
            requiredPhrases: task.requiredPhrases,
            responseText: "",
            usage: {
              inputTokens: 0,
              cachedInputTokens: 0,
              cacheCreationInputTokens: 0,
              outputTokens: 0,
            },
            costUsd: 0,
            violations: [
              `provider request failed; provider-side cost is unknown: ${[
                ...validated.plan.providers.map(
                  (configured) => env[configured.apiKeyEnv],
                ),
              ]
                .filter(
                  (secret) => typeof secret === "string" && secret.length > 0,
                )
                .reduce(
                  (message, secret) =>
                    message.replaceAll(secret, "[REDACTED]"),
                  error instanceof Error ? error.message : String(error),
                )}`,
            ],
          });
          break outer;
        }
      }
    }
  }
  return {
    ...base,
    status,
    startedAt,
    completedAt: now().toISOString(),
    costUsd: roundUsd(rawCostUsd),
    accountingComplete,
    passed:
      status === "completed" &&
      results.length === validated.requestCount &&
      results.every((result) => result.passed),
    results,
  };
}
