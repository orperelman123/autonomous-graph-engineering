import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
export class JsonlEventStore {
    path;
    #sequence = 0;
    #tail = Promise.resolve();
    constructor(directory, runId, initialSequence = 0) {
        this.path = resolve(directory, `${runId}.jsonl`);
        this.#sequence = initialSequence;
    }
    get sequence() {
        return this.#sequence;
    }
    async append(event, now = new Date()) {
        const complete = {
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
    path;
    #tail = Promise.resolve();
    constructor(directory, runId) {
        this.path = resolve(directory, `${runId}.checkpoint.json`);
    }
    async save(checkpoint) {
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
export async function loadCheckpoint(directory, runId) {
    const path = resolve(directory, `${runId}.checkpoint.json`);
    return JSON.parse(await readFile(path, "utf8"));
}
//# sourceMappingURL=persistence.js.map