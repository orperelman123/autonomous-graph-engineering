import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { GraphRunCheckpoint, GraphRunEvent } from "./types.js";

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function assertSafeRunId(runId: string): string {
  if (!RUN_ID_PATTERN.test(runId) || runId.includes("..")) {
    throw new Error(
      "run ID must contain only letters, digits, dot, underscore, or hyphen",
    );
  }
  return runId;
}

/**
 * Serializes writes while keeping the chain recoverable: a failed write
 * rejects its own caller, but the next write still runs instead of
 * inheriting the poisoned rejection forever.
 */
function chain(
  tail: Promise<void>,
  work: () => Promise<void>,
): { tail: Promise<void>; result: Promise<void> } {
  const result = tail.then(work);
  return { tail: result.catch(() => {}), result };
}

export class JsonlEventStore {
  readonly path: string;
  #sequence = 0;
  #tail: Promise<void> = Promise.resolve();

  constructor(directory: string, runId: string, initialSequence = 0) {
    this.path = resolve(directory, `${assertSafeRunId(runId)}.jsonl`);
    this.#sequence = initialSequence;
  }

  get sequence(): number {
    return this.#sequence;
  }

  async append(
    event: Omit<GraphRunEvent, "sequence" | "timestamp">,
    now = new Date(),
  ): Promise<GraphRunEvent> {
    const complete: GraphRunEvent = {
      ...event,
      sequence: ++this.#sequence,
      timestamp: now.toISOString(),
    };
    const { tail, result } = chain(this.#tail, async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await appendFile(this.path, `${JSON.stringify(complete)}\n`, "utf8");
    });
    this.#tail = tail;
    await result;
    return complete;
  }
}

export class CheckpointStore {
  readonly path: string;
  #tail: Promise<void> = Promise.resolve();

  constructor(directory: string, runId: string) {
    this.path = resolve(directory, `${assertSafeRunId(runId)}.checkpoint.json`);
  }

  async save(checkpoint: GraphRunCheckpoint): Promise<void> {
    const serialized = `${JSON.stringify(checkpoint, null, 2)}\n`;
    const { tail, result } = chain(this.#tail, async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, serialized, "utf8");
      await rename(temporary, this.path);
    });
    this.#tail = tail;
    await result;
  }
}

function assertCheckpointShape(value: unknown, path: string): GraphRunCheckpoint {
  const fail = (reason: string): never => {
    throw new Error(`invalid checkpoint at ${path}: ${reason}`);
  };
  if (!value || typeof value !== "object") fail("not an object");
  const checkpoint = value as Record<string, unknown>;
  if (checkpoint.version !== "1.0") fail("unsupported version");
  if (typeof checkpoint.runId !== "string") fail("missing runId");
  if (typeof checkpoint.graphHash !== "string") fail("missing graphHash");
  if (
    checkpoint.status !== "running" &&
    checkpoint.status !== "completed" &&
    checkpoint.status !== "failed" &&
    checkpoint.status !== "needs_confirmation"
  ) {
    fail("invalid status");
  }
  if (!checkpoint.graph || typeof checkpoint.graph !== "object") {
    fail("missing graph");
  }
  const graph = checkpoint.graph as Record<string, unknown>;
  if (!Array.isArray(graph.nodes)) fail("graph has no node list");
  if (!graph.budgets || typeof graph.budgets !== "object") {
    fail("graph has no budgets");
  }
  if (!checkpoint.nodes || typeof checkpoint.nodes !== "object") {
    fail("missing node results");
  }
  if (!checkpoint.outputs || typeof checkpoint.outputs !== "object") {
    fail("missing outputs");
  }
  if (!checkpoint.usage || typeof checkpoint.usage !== "object") {
    fail("missing usage");
  }
  if (typeof checkpoint.repairRounds !== "number") fail("missing repairRounds");
  if (typeof checkpoint.eventSequence !== "number") {
    fail("missing eventSequence");
  }
  if (
    checkpoint.elapsedMs !== undefined &&
    (typeof checkpoint.elapsedMs !== "number" || checkpoint.elapsedMs < 0)
  ) {
    fail("invalid elapsedMs");
  }
  return value as GraphRunCheckpoint;
}

export async function loadCheckpoint(
  directory: string,
  runId: string,
): Promise<GraphRunCheckpoint> {
  const path = resolve(directory, `${assertSafeRunId(runId)}.checkpoint.json`);
  return assertCheckpointShape(
    JSON.parse(await readFile(path, "utf8")),
    path,
  );
}
