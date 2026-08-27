export const PROMPT_CONTEXT_LIMITS = Object.freeze({
    scalarCharacters: 8_192,
    arrayItems: 32,
    arrayItemCharacters: 1_024,
    renderedContextBytes: 65_536,
    effectivePromptBytes: 1_048_576,
});
const CONTEXT_KEYS = new Set([
    "cwd",
    "projectName",
    "frameworks",
    "availableTools",
    "conversationSummary",
    "instructions",
]);
const contextSources = new WeakMap();
function utf8Bytes(value) {
    return Buffer.byteLength(value, "utf8");
}
function freezeContext(context) {
    return Object.freeze({
        ...context,
        ...(context.frameworks
            ? { frameworks: Object.freeze([...context.frameworks]) }
            : {}),
        ...(context.availableTools
            ? {
                availableTools: Object.freeze([
                    ...context.availableTools,
                ]),
            }
            : {}),
        ...(context.instructions
            ? { instructions: Object.freeze([...context.instructions]) }
            : {}),
    });
}
function assertPlainObject(value) {
    if (typeof value !== "object" ||
        value === null ||
        Array.isArray(value)) {
        throw new Error("context must be an object");
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new Error("context must be a plain object");
    }
}
function normalizeScalar(field, value) {
    if (value === undefined)
        return undefined;
    if (typeof value !== "string") {
        throw new Error(`context.${field} must be a string`);
    }
    if (value.trim() === "") {
        throw new Error(`context.${field} must not be blank`);
    }
    if (value.length > PROMPT_CONTEXT_LIMITS.scalarCharacters) {
        throw new Error(`context.${field} exceeds the ${PROMPT_CONTEXT_LIMITS.scalarCharacters} character limit`);
    }
    return value;
}
function normalizeArray(field, value) {
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value)) {
        throw new Error(`context.${field} must be an array of strings`);
    }
    if (value.length > PROMPT_CONTEXT_LIMITS.arrayItems) {
        throw new Error(`context.${field} exceeds the ${PROMPT_CONTEXT_LIMITS.arrayItems} item limit`);
    }
    const result = [];
    const seen = new Set();
    for (const item of value) {
        if (typeof item !== "string") {
            throw new Error(`context.${field} must contain only strings`);
        }
        if (item.trim() === "") {
            throw new Error(`context.${field} must not contain blank strings`);
        }
        if (item.length > PROMPT_CONTEXT_LIMITS.arrayItemCharacters) {
            throw new Error(`context.${field} item exceeds the ${PROMPT_CONTEXT_LIMITS.arrayItemCharacters} character limit`);
        }
        if (!seen.has(item)) {
            seen.add(item);
            result.push(item);
        }
    }
    return result.length > 0 ? result : undefined;
}
function sourceLabel(source) {
    if (source === "explicit_cwd") {
        return "Context source: filesystem inspection of an explicit working directory";
    }
    if (source === "process_cwd") {
        return "Context source: filesystem inspection of the process working directory";
    }
    return "Context source: caller supplied";
}
export function markPromptContextSource(context, source) {
    const protectedContext = freezeContext(context);
    contextSources.set(protectedContext, source);
    return protectedContext;
}
export function getPromptContextSource(context) {
    return contextSources.get(context) ?? "caller";
}
export function normalizePromptContext(value, source) {
    if (value === undefined)
        return undefined;
    assertPlainObject(value);
    for (const key of Object.keys(value)) {
        if (!CONTEXT_KEYS.has(key)) {
            throw new Error(`context contains unsupported field: ${key}`);
        }
    }
    const cwd = normalizeScalar("cwd", value.cwd);
    const projectName = normalizeScalar("projectName", value.projectName);
    const conversationSummary = normalizeScalar("conversationSummary", value.conversationSummary);
    const frameworks = normalizeArray("frameworks", value.frameworks);
    const availableTools = normalizeArray("availableTools", value.availableTools);
    const instructions = normalizeArray("instructions", value.instructions);
    const normalizedContext = {
        ...(cwd === undefined ? {} : { cwd }),
        ...(projectName === undefined ? {} : { projectName }),
        ...(frameworks === undefined ? {} : { frameworks }),
        ...(availableTools === undefined ? {} : { availableTools }),
        ...(conversationSummary === undefined ? {} : { conversationSummary }),
        ...(instructions === undefined ? {} : { instructions }),
    };
    const resolvedSource = source ?? getPromptContextSource(value);
    const context = resolvedSource === "caller"
        ? freezeContext(normalizedContext)
        : markPromptContextSource(normalizedContext, resolvedSource);
    const lines = renderPromptContextLines(context, resolvedSource);
    if (utf8Bytes(lines.join("\n")) >
        PROMPT_CONTEXT_LIMITS.renderedContextBytes) {
        throw new Error(`rendered context exceeds the ${PROMPT_CONTEXT_LIMITS.renderedContextBytes} byte limit`);
    }
    return { context, source: resolvedSource, lines };
}
export function renderPromptContextLines(context, source) {
    const result = [];
    if (Object.keys(context).length > 0)
        result.push(sourceLabel(source));
    if (context.projectName)
        result.push(`Project: ${context.projectName}`);
    if (context.cwd)
        result.push(`Working directory: ${context.cwd}`);
    if (context.frameworks?.length) {
        result.push(`Detected stack: ${context.frameworks.join(", ")}`);
    }
    if (context.availableTools?.length) {
        result.push(`Available tools: ${context.availableTools.join(", ")}`);
    }
    if (context.conversationSummary) {
        result.push(`Conversation context: ${context.conversationSummary}`);
    }
    if (context.instructions?.length)
        result.push(...context.instructions);
    return result;
}
export function assertEffectivePromptWithinBudget(effectivePrompt) {
    if (typeof effectivePrompt !== "string") {
        throw new Error("effective prompt must be a string");
    }
    const bytes = utf8Bytes(effectivePrompt);
    if (bytes > PROMPT_CONTEXT_LIMITS.effectivePromptBytes) {
        throw new Error(`effective prompt exceeds the ${PROMPT_CONTEXT_LIMITS.effectivePromptBytes} byte limit`);
    }
}
//# sourceMappingURL=context-policy.js.map