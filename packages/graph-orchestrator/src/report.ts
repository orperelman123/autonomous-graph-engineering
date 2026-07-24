import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadCheckpoint } from "./persistence.js";
import { graphFingerprint } from "./runtime.js";
import type {
  GraphRunCheckpoint,
  GraphRunEvent,
  NodeRunResult,
  TokenUsage,
} from "./types.js";

export interface PortableRunReport {
  version: "1.0";
  runId: string;
  status: GraphRunCheckpoint["status"];
  graph: {
    id: string;
    fingerprint: string;
    integrityVerified: boolean;
    autonomy: GraphRunCheckpoint["graph"]["autonomy"];
    createdAt: string;
    budgets: GraphRunCheckpoint["graph"]["budgets"];
    nodes: Array<{
      id: string;
      kind: GraphRunCheckpoint["graph"]["nodes"][number]["kind"];
      dependsOn: string[];
      permission: GraphRunCheckpoint["graph"]["nodes"][number]["permission"];
      executor?: GraphRunCheckpoint["graph"]["nodes"][number]["executor"];
    }>;
  };
  execution: {
    startedAt: string;
    updatedAt: string;
    repairRounds: number;
    usage: TokenUsage;
    nodes: Array<{
      id: string;
      state: NodeRunResult["state"];
      failureKind?: NodeRunResult["failureKind"];
      startedAt?: string;
      completedAt?: string;
      usage?: TokenUsage;
    }>;
  };
  verifier: {
    nodeId?: string;
    accepted?: boolean;
    reasonCount: number;
  };
  evidence: {
    checkpointSha256: string;
    auditSha256: string;
    auditSequenceVerified: boolean;
    events: Array<{
      sequence: number;
      timestamp: string;
      type: GraphRunEvent["type"];
      nodeId?: string;
    }>;
  };
  redaction: {
    policy: "structural-only";
    omitted: string[];
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function selected(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function reasonCount(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const reasons = (value as Record<string, unknown>).reasons;
  return Array.isArray(reasons) ? reasons.length : 0;
}

export async function createPortableRunReport(
  directory: string,
  runId: string,
): Promise<PortableRunReport> {
  const checkpointPath = resolve(directory, `${runId}.checkpoint.json`);
  const auditPath = resolve(directory, `${runId}.jsonl`);
  const [checkpointRaw, auditRaw, checkpoint] = await Promise.all([
    readFile(checkpointPath, "utf8"),
    readFile(auditPath, "utf8"),
    loadCheckpoint(directory, runId),
  ]);
  const events = auditRaw
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as GraphRunEvent);
  if (checkpoint.runId !== runId) {
    throw new Error(
      `checkpoint run ID mismatch: expected ${runId}, found ${checkpoint.runId}`,
    );
  }
  const auditSequenceVerified =
    events.length > 0 &&
    events.every(
      (event, index) =>
        event.sequence === index + 1 && event.runId === checkpoint.runId,
    );
  const policy = checkpoint.graph.repairPolicy;
  const verifierOutput = policy
    ? checkpoint.outputs[policy.verifierNodeId]
    : undefined;
  const acceptedValue = policy
    ? selected(verifierOutput, policy.acceptedField)
    : undefined;

  return {
    version: "1.0",
    runId: checkpoint.runId,
    status: checkpoint.status,
    graph: {
      id: checkpoint.graph.id,
      fingerprint: checkpoint.graphHash,
      integrityVerified:
        checkpoint.graphHash === graphFingerprint(checkpoint.graph),
      autonomy: checkpoint.graph.autonomy,
      createdAt: checkpoint.graph.createdAt,
      budgets: checkpoint.graph.budgets,
      nodes: checkpoint.graph.nodes.map((node) => ({
        id: node.id,
        kind: node.kind,
        dependsOn: node.dependsOn,
        permission: node.permission,
        ...(node.executor ? { executor: node.executor } : {}),
      })),
    },
    execution: {
      startedAt: checkpoint.startedAt,
      updatedAt: checkpoint.updatedAt,
      repairRounds: checkpoint.repairRounds,
      usage: checkpoint.usage,
      nodes: checkpoint.graph.nodes.map((node) => {
        const result = checkpoint.nodes[node.id];
        return {
          id: node.id,
          state: result?.state ?? "pending",
          ...(result?.failureKind
            ? { failureKind: result.failureKind }
            : {}),
          ...(result?.startedAt ? { startedAt: result.startedAt } : {}),
          ...(result?.completedAt
            ? { completedAt: result.completedAt }
            : {}),
          ...(result?.usage ? { usage: result.usage } : {}),
        };
      }),
    },
    verifier: {
      ...(policy ? { nodeId: policy.verifierNodeId } : {}),
      ...(typeof acceptedValue === "boolean"
        ? { accepted: acceptedValue }
        : {}),
      reasonCount: reasonCount(verifierOutput),
    },
    evidence: {
      checkpointSha256: sha256(checkpointRaw),
      auditSha256: sha256(auditRaw),
      auditSequenceVerified,
      events: events.map((event) => ({
        sequence: event.sequence,
        timestamp: event.timestamp,
        type: event.type,
        ...(event.nodeId ? { nodeId: event.nodeId } : {}),
      })),
    },
    redaction: {
      policy: "structural-only",
      omitted: [
        "graph goal, node labels, prompts, and refinement metadata",
        "node outputs, verifier reasons, errors, and audit event data",
        "local checkpoint and audit file paths",
      ],
    },
  };
}
