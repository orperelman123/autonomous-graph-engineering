import { SecurityGatedExecutor } from "./security.js";
import type {
  AgentExecutionRequest,
  AgentExecutionResult,
  GraphExecutor,
  GraphRunCheckpoint,
  GraphRunEvent,
  NodePermission,
  TokenUsage,
} from "./types.js";
import type { GraphSecurityProvider } from "./security.js";

const EXTENSION_NAME = /^[a-z][a-z0-9-]{0,63}$/;
const RESERVED_NAMES = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "codex",
  "claude",
  "local",
]);
const PERMISSIONS = new Set<NodePermission>([
  "none",
  "read",
  "write",
  "external",
  "destructive",
]);
const USAGE_FIELDS = new Set<keyof TokenUsage>([
  "inputTokens",
  "cachedInputTokens",
  "cacheCreationInputTokens",
  "outputTokens",
  "reasoningOutputTokens",
  "costUsd",
]);

export function isValidExecutorName(value: string): boolean {
  return (
    EXTENSION_NAME.test(value) &&
    value !== "constructor" &&
    value !== "prototype"
  );
}

export function isValidExtensionName(value: string): boolean {
  return isValidExecutorName(value) && !RESERVED_NAMES.has(value);
}

export interface ExecutorExtension {
  executor: GraphExecutor;
  permissions: readonly NodePermission[];
}

export interface ExtensionGradeCriterion {
  id: string;
  passed: boolean;
  detail: string;
}

export interface ExtensionGradeResult {
  criteria: ExtensionGradeCriterion[];
}

export interface GraphGraderContext {
  version: "1";
  checkpoint: Readonly<GraphRunCheckpoint>;
  auditEvents: readonly Readonly<GraphRunEvent>[];
}

export interface GraphGrader {
  readonly name: string;
  grade(context: GraphGraderContext): Promise<ExtensionGradeResult>;
}

export interface GraphExtensionRegistryOptions {
  securityProvider?: GraphSecurityProvider;
}

class PermissionBoundExecutor implements GraphExecutor {
  readonly name: string;
  private readonly permissions: ReadonlySet<NodePermission>;

  constructor(
    private readonly delegate: GraphExecutor,
    permissions: readonly NodePermission[],
  ) {
    this.name = delegate.name;
    if (
      permissions.length === 0 ||
      permissions.some((permission) => !PERMISSIONS.has(permission))
    ) {
      throw new Error(
        `executor extension ${this.name} requires explicit valid permissions`,
      );
    }
    this.permissions = new Set(permissions);
  }

  async execute(
    request: AgentExecutionRequest,
  ): Promise<AgentExecutionResult> {
    if (!this.permissions.has(request.permission)) {
      throw new Error(
        `executor extension ${this.name} is not authorized for ${request.permission} permission`,
      );
    }
    const result = await this.delegate.execute(request);
    assertExecutionResult(this.name, result);
    return result;
  }
}

function assertExecutionResult(
  name: string,
  result: AgentExecutionResult,
): void {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error(`executor extension ${name} returned an invalid result`);
  }
  for (const key of Object.keys(result)) {
    if (key !== "output" && key !== "usage") {
      throw new Error(
        `executor extension ${name} returned unsupported field ${key}`,
      );
    }
  }
  if (!Object.hasOwn(result, "output")) {
    throw new Error(`executor extension ${name} result requires output`);
  }
  if (result.usage !== undefined) {
    if (
      !result.usage ||
      typeof result.usage !== "object" ||
      Array.isArray(result.usage)
    ) {
      throw new Error(`executor extension ${name} returned invalid usage`);
    }
    for (const [key, value] of Object.entries(result.usage)) {
      if (
        !USAGE_FIELDS.has(key as keyof TokenUsage) ||
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0
      ) {
        throw new Error(
          `executor extension ${name} returned invalid usage field ${key}`,
        );
      }
    }
  }
}

export class GraphExtensionRegistry {
  private readonly executorExtensions = new Map<string, GraphExecutor>();
  private readonly graderExtensions = new Map<string, GraphGrader>();
  private sealed = false;

  constructor(private readonly options: GraphExtensionRegistryOptions = {}) {}

  registerExecutor(extension: ExecutorExtension): this {
    this.assertOpen();
    const name = extension.executor?.name;
    if (typeof name !== "string" || !isValidExtensionName(name)) {
      throw new Error(`invalid or reserved executor extension name: ${name}`);
    }
    if (this.executorExtensions.has(name)) {
      throw new Error(`executor extension is already registered: ${name}`);
    }
    const delegate = this.options.securityProvider
      ? new SecurityGatedExecutor(
          extension.executor,
          this.options.securityProvider,
        )
      : extension.executor;
    this.executorExtensions.set(
      name,
      new PermissionBoundExecutor(delegate, extension.permissions),
    );
    return this;
  }

  registerGrader(grader: GraphGrader): this {
    this.assertOpen();
    const name = grader?.name;
    if (typeof name !== "string" || !isValidExtensionName(name)) {
      throw new Error(`invalid or reserved grader extension name: ${name}`);
    }
    if (this.graderExtensions.has(name)) {
      throw new Error(`grader extension is already registered: ${name}`);
    }
    if (typeof grader.grade !== "function") {
      throw new Error(`grader extension ${name} requires a grade function`);
    }
    this.graderExtensions.set(name, grader);
    return this;
  }

  seal(): this {
    this.sealed = true;
    return this;
  }

  executors(): Readonly<Record<string, GraphExecutor>> {
    return Object.freeze(Object.fromEntries(this.executorExtensions));
  }

  graders(): readonly GraphGrader[] {
    return Object.freeze([...this.graderExtensions.values()]);
  }

  private assertOpen(): void {
    if (this.sealed) {
      throw new Error("extension registry is sealed");
    }
  }
}

export interface RunExtensionGradersOptions {
  timeoutMs?: number;
  maxGraders?: number;
  maxCriteriaPerGrader?: number;
  maxDetailLength?: number;
}

function cloneAndFreeze<T>(value: T): Readonly<T> {
  const clone = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== "object" || Object.isFrozen(item)) return;
    Object.freeze(item);
    for (const child of Object.values(item)) freeze(child);
  };
  freeze(clone);
  return clone;
}

export async function runExtensionGraders(
  graders: readonly GraphGrader[],
  context: GraphGraderContext,
  options: RunExtensionGradersOptions = {},
): Promise<ExtensionGradeCriterion[]> {
  const maxGraders = options.maxGraders ?? 16;
  const maxCriteria = options.maxCriteriaPerGrader ?? 32;
  const maxDetailLength = options.maxDetailLength ?? 1_000;
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (
    !Number.isInteger(maxGraders) ||
    maxGraders < 0 ||
    !Number.isInteger(maxCriteria) ||
    maxCriteria < 1 ||
    !Number.isInteger(maxDetailLength) ||
    maxDetailLength < 1 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1
  ) {
    throw new Error("extension grader limits must be positive integers");
  }
  if (graders.length > maxGraders) {
    throw new Error(
      `extension grader count ${graders.length} exceeds ${maxGraders}`,
    );
  }
  const safeContext = cloneAndFreeze(context) as GraphGraderContext;
  const criteria: ExtensionGradeCriterion[] = [];
  const ids = new Set<string>();
  for (const grader of graders) {
    if (!isValidExtensionName(grader.name)) {
      throw new Error(`invalid or reserved grader extension name: ${grader.name}`);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        grader.grade(safeContext),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`grader extension ${grader.name} timed out`)),
            timeoutMs,
          );
        }),
      ]);
      if (
        !result ||
        typeof result !== "object" ||
        Array.isArray(result) ||
        Object.keys(result).some((key) => key !== "criteria") ||
        !Array.isArray(result.criteria) ||
        result.criteria.length > maxCriteria
      ) {
        throw new Error(
          `grader extension ${grader.name} returned an invalid result`,
        );
      }
      for (const criterion of result.criteria) {
        if (
          !criterion ||
          typeof criterion !== "object" ||
          Array.isArray(criterion) ||
          Object.keys(criterion).some(
            (key) => !["id", "passed", "detail"].includes(key),
          ) ||
          typeof criterion.id !== "string" ||
          !isValidExecutorName(criterion.id) ||
          typeof criterion.passed !== "boolean" ||
          typeof criterion.detail !== "string" ||
          criterion.detail.length > maxDetailLength
        ) {
          throw new Error(
            `grader extension ${grader.name} returned an invalid criterion`,
          );
        }
        const id = `extension:${grader.name}:${criterion.id}`;
        if (ids.has(id)) {
          throw new Error(`duplicate extension grade criterion: ${id}`);
        }
        ids.add(id);
        criteria.push({ ...criterion, id });
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return criteria;
}
