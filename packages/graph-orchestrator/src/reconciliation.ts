import { CheckpointStore, JsonlEventStore, loadCheckpoint } from "./persistence.js";
import { validatedOutput } from "./output-schema.js";
import type {
  GraphRunCheckpoint,
  NodePermission,
  ReconciliationRecord,
  TerminationEvidence,
} from "./types.js";
import { isValidNodeId, validateGraph } from "./validator.js";

const SIDE_EFFECTING = new Set<NodePermission>([
  "write",
  "external",
  "destructive",
]);

export function reconciliationToken(
  runId: string,
  graphHash: string,
  nodeId: string,
): string {
  return `reconcile:${runId}:${graphHash.slice(0, 16)}:${nodeId}`;
}

export function executionIdempotencyKey(
  runId: string,
  nodeId: string,
): string {
  return `graph:${runId}:node:${nodeId}`;
}

export function reconciliationNeeds(
  checkpoint: GraphRunCheckpoint,
): Array<{
  nodeId: string;
  token: string;
  state: string;
  idempotencyKey: string;
  attemptId?: string;
  requiresTerminationConfirmation: boolean;
}> {
  const byId = new Map(checkpoint.graph.nodes.map((node) => [node.id, node]));
  return Object.values(checkpoint.nodes)
    .filter((state) => {
      const permission = byId.get(state.nodeId)?.permission;
      return (
        (state.state === "running" || state.state === "failed") &&
        permission !== undefined &&
        SIDE_EFFECTING.has(permission)
      );
    })
    .map((state) => ({
      nodeId: state.nodeId,
      state: state.state,
      idempotencyKey:
        state.idempotencyKey ??
        executionIdempotencyKey(checkpoint.runId, state.nodeId),
      ...(state.attemptId ? { attemptId: state.attemptId } : {}),
      requiresTerminationConfirmation: state.failureKind === "timeout",
      token: reconciliationToken(
        checkpoint.runId,
        checkpoint.graphHash,
        state.nodeId,
      ),
    }));
}

export async function reconcileCheckpoint(input: {
  directory: string;
  runId: string;
  nodeId: string;
  token: string;
  outcome: "completed" | "not_applied";
  evidence: string;
  output?: unknown;
  terminationEvidence?: TerminationEvidence;
  now?: () => Date;
}): Promise<GraphRunCheckpoint> {
  const now = input.now ?? (() => new Date());
  const checkpoint = await loadCheckpoint(input.directory, input.runId);
  if (!isValidNodeId(input.nodeId)) {
    throw new Error(`invalid or reserved node id: ${input.nodeId}`);
  }
  const validation = validateGraph(checkpoint.graph);
  if (!validation.valid) {
    throw new Error(
      `checkpoint graph is invalid: ${validation.errors
        .map((issue) => issue.code)
        .join(", ")}`,
    );
  }
  const need = reconciliationNeeds(checkpoint).find(
    (entry) => entry.nodeId === input.nodeId,
  );
  if (!need) {
    throw new Error(
      `node ${input.nodeId} does not require side-effect reconciliation`,
    );
  }
  if (input.token !== need.token) {
    throw new Error("reconciliation token mismatch");
  }
  const evidence = input.evidence.trim();
  if (!evidence || evidence.length > 10_000) {
    throw new Error(
      "reconciliation evidence must contain 1 to 10000 characters",
    );
  }
  if (input.outcome === "completed" && input.output === undefined) {
    throw new Error("completed reconciliation requires --output-json");
  }
  if (
    input.outcome === "not_applied" &&
    need.requiresTerminationConfirmation &&
    !input.terminationEvidence
  ) {
    throw new Error(
      "timed-out side-effect reconciliation requires --termination-json with matching executor termination evidence",
    );
  }
  const node = checkpoint.graph.nodes.find(
    (candidate) => candidate.id === input.nodeId,
  );
  if (!node) throw new Error(`graph node missing: ${input.nodeId}`);
  if (input.terminationEvidence) {
    const termination = input.terminationEvidence;
    if (
      termination.status !== "terminated" ||
      !termination.method.trim() ||
      !Number.isFinite(Date.parse(termination.observedAt)) ||
      termination.attemptId !== need.attemptId ||
      termination.executor !== node.executor
    ) {
      throw new Error(
        "termination evidence must match the timed-out attempt and executor",
      );
    }
  }
  const output =
    input.outcome === "completed"
      ? validatedOutput(node, input.output)
      : undefined;
  const state = checkpoint.nodes[input.nodeId];
  if (!state) throw new Error(`checkpoint node missing: ${input.nodeId}`);
  const createdAt = now().toISOString();
  const record: ReconciliationRecord = {
    nodeId: input.nodeId,
    outcome: input.outcome,
    evidence,
    token: input.token,
    idempotencyKey: need.idempotencyKey,
    ...(input.terminationEvidence
      ? { terminationEvidence: input.terminationEvidence }
      : {}),
    createdAt,
  };
  if (input.outcome === "completed") {
    state.state = "completed";
    state.output = output;
    state.completedAt = createdAt;
    delete state.error;
    delete state.failureKind;
    Object.defineProperty(checkpoint.outputs, input.nodeId, {
      value: output,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  } else {
    state.state = "pending";
    delete state.output;
    delete state.error;
    delete state.failureKind;
    delete state.startedAt;
    delete state.completedAt;
    delete state.usage;
    Reflect.deleteProperty(checkpoint.outputs, input.nodeId);
  }
  checkpoint.status = "running";
  checkpoint.updatedAt = createdAt;
  checkpoint.reconciliations = [
    ...(checkpoint.reconciliations ?? []),
    record,
  ];
  const events = new JsonlEventStore(
    input.directory,
    input.runId,
    checkpoint.eventSequence,
  );
  await events.append(
    {
      runId: input.runId,
      type: "node_reconciled",
      nodeId: input.nodeId,
      data: {
        outcome: input.outcome,
        evidence,
        idempotencyKey: need.idempotencyKey,
        ...(input.terminationEvidence
          ? { terminationEvidence: input.terminationEvidence }
          : {}),
        ...(input.outcome === "completed" ? { output } : {}),
      },
    },
    now(),
  );
  checkpoint.eventSequence = events.sequence;
  const store = new CheckpointStore(input.directory, input.runId);
  await store.save(checkpoint);
  return checkpoint;
}
