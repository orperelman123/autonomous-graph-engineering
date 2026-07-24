import { CheckpointStore, JsonlEventStore, loadCheckpoint } from "./persistence.js";
import { validatedOutput } from "./output-schema.js";
import type {
  GraphRunCheckpoint,
  NodePermission,
  ReconciliationRecord,
} from "./types.js";

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

export function reconciliationNeeds(
  checkpoint: GraphRunCheckpoint,
): Array<{ nodeId: string; token: string; state: string }> {
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
  now?: () => Date;
}): Promise<GraphRunCheckpoint> {
  const now = input.now ?? (() => new Date());
  const checkpoint = await loadCheckpoint(input.directory, input.runId);
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
  const node = checkpoint.graph.nodes.find(
    (candidate) => candidate.id === input.nodeId,
  );
  if (!node) throw new Error(`graph node missing: ${input.nodeId}`);
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
    createdAt,
  };
  if (input.outcome === "completed") {
    state.state = "completed";
    state.output = output;
    state.completedAt = createdAt;
    delete state.error;
    checkpoint.outputs[input.nodeId] = output;
  } else {
    state.state = "pending";
    delete state.output;
    delete state.error;
    delete state.startedAt;
    delete state.completedAt;
    delete state.usage;
    delete checkpoint.outputs[input.nodeId];
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
