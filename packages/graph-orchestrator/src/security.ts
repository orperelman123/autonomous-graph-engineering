import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ClaudeCliExecutor,
  CodexCliExecutor,
  LocalEchoExecutor,
} from "./executors.js";
import type {
  AgentExecutionRequest,
  AgentExecutionResult,
  GraphExecutor,
  NodePermission,
} from "./types.js";

export interface SecurityAuthorizationRequest {
  version: "1";
  runId: string;
  nodeId: string;
  executor: string;
  permission: NodePermission;
  promptSha256: string;
  inputSha256: string;
  idempotencyKeySha256?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface SecurityAuthorizationDecision {
  decision: "allow" | "hold" | "block";
}

export interface GraphSecurityProvider {
  authorize(
    request: SecurityAuthorizationRequest,
  ): Promise<SecurityAuthorizationDecision>;
}

interface AtbashClient {
  auditToolCall(input: {
    toolName: string;
    args: Record<string, unknown>;
    context: string;
  }): Promise<{ verdict: string; allow: boolean }>;
}

type SecurityProviderModule = {
  createGraphSecurityProvider?: () =>
    | GraphSecurityProvider
    | Promise<GraphSecurityProvider>;
};

export class AtbashSecurityProvider implements GraphSecurityProvider {
  constructor(private readonly client: AtbashClient) {}

  async authorize(
    request: SecurityAuthorizationRequest,
  ): Promise<SecurityAuthorizationDecision> {
    const result = await this.client.auditToolCall({
      toolName: `graph-engineer.${request.executor}`,
      args: {
        protocolVersion: request.version,
        runId: request.runId,
        nodeId: request.nodeId,
        permission: request.permission,
        promptSha256: request.promptSha256,
        inputSha256: request.inputSha256,
        ...(request.idempotencyKeySha256
          ? { idempotencyKeySha256: request.idempotencyKeySha256 }
          : {}),
      },
      context: "Graph Engineer executor authorization",
    });
    if (result.allow === true) return { decision: "allow" };
    if (result.verdict === "HOLD") return { decision: "hold" };
    if (result.verdict === "BLOCK" || result.verdict === "ERROR") {
      return { decision: "block" };
    }
    return { decision: "block" };
  }
}

class LazyAtbashSecurityProvider implements GraphSecurityProvider {
  private provider?: Promise<AtbashSecurityProvider>;

  private async load(): Promise<AtbashSecurityProvider> {
    if (!this.provider) {
      this.provider = import("@atbash/sdk").then(
        ({ Atbash }) =>
          new AtbashSecurityProvider(
            Atbash.fromConfig({
              failClosed: true,
              logger: {},
            }),
          ),
      );
    }
    return await this.provider;
  }

  async authorize(
    request: SecurityAuthorizationRequest,
  ): Promise<SecurityAuthorizationDecision> {
    return await (await this.load()).authorize(request);
  }
}

function sha256(value: unknown): string {
  const serialized =
    typeof value === "string" ? value : (JSON.stringify(value) ?? "undefined");
  return createHash("sha256").update(serialized).digest("hex");
}

function authorizationRequest(
  executor: GraphExecutor,
  request: AgentExecutionRequest,
): SecurityAuthorizationRequest {
  return {
    version: "1",
    runId: request.runId,
    nodeId: request.nodeId,
    executor: executor.name,
    permission: request.permission,
    promptSha256: sha256(request.prompt),
    inputSha256: sha256(request.input),
    ...(request.idempotencyKey
      ? { idempotencyKeySha256: sha256(request.idempotencyKey) }
      : {}),
    timeoutMs: request.timeoutMs,
    ...(request.signal ? { signal: request.signal } : {}),
  };
}

function isProvider(value: unknown): value is GraphSecurityProvider {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as GraphSecurityProvider).authorize === "function"
  );
}

class LazyModuleSecurityProvider implements GraphSecurityProvider {
  private provider?: Promise<GraphSecurityProvider>;

  constructor(private readonly modulePath: string) {}

  private async load(): Promise<GraphSecurityProvider> {
    if (!this.provider) {
      this.provider = (async () => {
        const loaded = (await import(
          pathToFileURL(this.modulePath).href
        )) as SecurityProviderModule;
        if (typeof loaded.createGraphSecurityProvider !== "function") {
          throw new Error("provider factory is unavailable");
        }
        const provider = await loaded.createGraphSecurityProvider();
        if (!isProvider(provider)) {
          throw new Error("provider contract is invalid");
        }
        return provider;
      })();
    }
    return await this.provider;
  }

  async authorize(
    request: SecurityAuthorizationRequest,
  ): Promise<SecurityAuthorizationDecision> {
    return await (await this.load()).authorize(request);
  }
}

export class SecurityGatedExecutor implements GraphExecutor {
  readonly name: string;

  constructor(
    private readonly delegate: GraphExecutor,
    private readonly provider: GraphSecurityProvider,
  ) {
    this.name = delegate.name;
  }

  async execute(
    request: AgentExecutionRequest,
  ): Promise<AgentExecutionResult> {
    let decision: SecurityAuthorizationDecision;
    try {
      decision = await this.provider.authorize(
        authorizationRequest(this.delegate, request),
      );
    } catch {
      throw new Error("external security provider unavailable; execution denied");
    }
    if (
      decision?.decision !== "allow" &&
      decision?.decision !== "hold" &&
      decision?.decision !== "block"
    ) {
      throw new Error("external security provider returned an invalid decision");
    }
    if (decision.decision !== "allow") {
      throw new Error(
        `external security provider ${decision.decision === "hold" ? "held" : "blocked"} execution`,
      );
    }
    return await this.delegate.execute(request);
  }
}

export function securityProviderFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): GraphSecurityProvider | undefined {
  const selected = environment.GRAPH_ENGINEER_SECURITY_PROVIDER?.trim();
  const modulePath = environment.GRAPH_ENGINEER_SECURITY_PROVIDER_MODULE;
  if (selected && modulePath) {
    return {
      async authorize() {
        throw new Error("multiple security providers configured");
      },
    };
  }
  if (selected === "atbash") return new LazyAtbashSecurityProvider();
  if (selected) {
    return {
      async authorize() {
        throw new Error("unknown security provider");
      },
    };
  }
  if (!modulePath) return undefined;
  if (!isAbsolute(modulePath)) {
    return {
      async authorize() {
        throw new Error("provider module path must be absolute");
      },
    };
  }
  return new LazyModuleSecurityProvider(modulePath);
}

export function defaultExecutors(
  environment: NodeJS.ProcessEnv = process.env,
): {
  codex: GraphExecutor;
  claude: GraphExecutor;
  local: GraphExecutor;
} {
  const executors = {
    codex: new CodexCliExecutor(),
    claude: new ClaudeCliExecutor(),
    local: new LocalEchoExecutor(),
  };
  const provider = securityProviderFromEnvironment(environment);
  if (!provider) return executors;
  return {
    codex: new SecurityGatedExecutor(executors.codex, provider),
    claude: new SecurityGatedExecutor(executors.claude, provider),
    local: new SecurityGatedExecutor(executors.local, provider),
  };
}
