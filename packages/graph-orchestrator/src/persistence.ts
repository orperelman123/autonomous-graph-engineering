import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { GraphRunCheckpoint, GraphRunEvent } from "./types.js";

export class JsonlEventStore {
  readonly path: string;
  #sequence = 0;
  #tail: Promise<void> = Promise.resolve();

  constructor(directory: string, runId: string, initialSequence = 0) {
    this.path = resolve(directory, `${runId}.jsonl`);
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
    this.#tail = this.#tail.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await appendFile(this.path, `${JSON.stringify(complete)}\n`, "utf8");
    });
    await this.#tail;
    return complete;
  }
}

export class CheckpointStore {
  readonly path: string;
  #tail: Promise<void> = Promise.resolve();

  constructor(directory: string, runId: string) {
    this.path = resolve(directory, `${runId}.checkpoint.json`);
  }

  async save(checkpoint: GraphRunCheckpoint): Promise<void> {
    const serialized = `${JSON.stringify(checkpoint, null, 2)}\n`;
    this.#tail = this.#tail.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, serialized, "utf8");
      await rename(temporary, this.path);
    });
    await this.#tail;
  }
}

export async function loadCheckpoint(
  directory: string,
  runId: string,
): Promise<GraphRunCheckpoint> {
  const path = resolve(directory, `${runId}.checkpoint.json`);
  return JSON.parse(await readFile(path, "utf8")) as GraphRunCheckpoint;
}
