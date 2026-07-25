import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  collectLocalDashboardSnapshot,
  isSafeDashboardRunId,
  startLocalDashboard,
} from "../src/dashboard.js";
import { planGraph } from "../src/planner.js";
import { graphFingerprint } from "../src/runtime.js";
import type {
  GraphRunCheckpoint,
  GraphRunEvent,
} from "../src/types.js";

async function writeRun(
  directory: string,
  filenameRunId: string,
  options: {
    embeddedRunId?: string;
    graphId?: string;
    status?: GraphRunCheckpoint["status"];
    updatedAt?: string;
    costUsd?: number;
  } = {},
): Promise<void> {
  const runId = options.embeddedRunId ?? filenameRunId;
  const graph = planGraph({
    prompt: "Synthetic dashboard fixture.",
    primaryExecutor: "local",
    verifierExecutor: "local",
  });
  graph.id = options.graphId ?? "dashboard-fixture";
  const now = options.updatedAt ?? new Date(0).toISOString();
  const checkpoint: GraphRunCheckpoint = {
    version: "1.0",
    graph,
    graphHash: graphFingerprint(graph),
    runId,
    status: options.status ?? "completed",
    outputs: {},
    nodes: Object.fromEntries(
      graph.nodes.map((node) => [
        node.id,
        { nodeId: node.id, state: "completed" as const },
      ]),
    ),
    repairRounds: 0,
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      ...(options.costUsd === undefined
        ? {}
        : { costUsd: options.costUsd }),
    },
    startedAt: now,
    updatedAt: now,
    eventSequence: 1,
  };
  const event: GraphRunEvent = {
    sequence: 1,
    runId,
    timestamp: now,
    type: "run_started",
    data: { private: "must not reach the dashboard" },
  };
  await writeFile(
    join(directory, `${filenameRunId}.checkpoint.json`),
    JSON.stringify(checkpoint),
    "utf8",
  );
  await writeFile(
    join(directory, `${filenameRunId}.jsonl`),
    `${JSON.stringify(event)}\n`,
    "utf8",
  );
}

test("local dashboard snapshot is strict, deterministic, redacted, and host-neutral", async () => {
  const directory = await mkdtemp(join(tmpdir(), "graph-dashboard-"));
  try {
    await writeRun(directory, "z-complete", {
      graphId: "<img src=x onerror=alert(1)>",
      costUsd: 0.25,
    });
    await writeRun(directory, "a-stale", {
      status: "running",
      updatedAt: new Date(0).toISOString(),
    });
    const snapshot = await collectLocalDashboardSnapshot(directory, {
      now: 2_000_000,
      staleAfterMs: 1_000,
    });
    assert.deepEqual(
      snapshot.runs.map((run) => run.runId),
      ["a-stale", "z-complete"],
    );
    assert.equal(snapshot.runs[0]?.state, "stale");
    assert.equal(snapshot.runs[1]?.state, "valid");
    assert.deepEqual(snapshot.compatibility, {
      status: "contract-only",
      hosts: ["codex", "claude", "cursor", "copilot", "hermes"],
    });
    assert.equal(snapshot.truncated, false);
    const serialized = JSON.stringify(snapshot);
    assert.doesNotMatch(serialized, /img|onerror|private|graph-dashboard-/i);

    const schema = JSON.parse(
      await readFile(
        new URL(
          "../../../schemas/local-dashboard-snapshot.schema.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    assert.equal(
      validate(snapshot),
      true,
      JSON.stringify(validate.errors, null, 2),
    );
    const unsupportedClaim = structuredClone(snapshot) as {
      compatibility: { status: string };
    };
    unsupportedClaim.compatibility.status = "live-tested";
    assert.equal(validate(unsupportedClaim), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("local dashboard reports deterministic truncation at the run limit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "graph-dashboard-cap-"));
  try {
    await Promise.all(
      Array.from({ length: 101 }, (_, index) =>
        writeFile(
          join(
            directory,
            `cap-${String(index).padStart(3, "0")}.checkpoint.json`,
          ),
          "{}",
          "utf8",
        ),
      ),
    );
    const snapshot = await collectLocalDashboardSnapshot(directory);
    assert.equal(snapshot.runs.length, 100);
    assert.equal(snapshot.truncated, true);
    assert.equal(snapshot.runs[0]?.runId, "cap-000");
    assert.equal(snapshot.runs[99]?.runId, "cap-099");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("local dashboard rejects untrusted fields hidden behind checkpoint types", async () => {
  const directory = await mkdtemp(join(tmpdir(), "graph-dashboard-types-"));
  try {
    await writeRun(directory, "typed-hostile");
    const path = join(directory, "typed-hostile.checkpoint.json");
    const checkpoint = JSON.parse(await readFile(path, "utf8"));
    checkpoint.graph.budgets.privatePath = "/root/private";
    checkpoint.usage.secret = "must-not-render";
    checkpoint.graphHash = graphFingerprint(checkpoint.graph);
    await writeFile(path, JSON.stringify(checkpoint), "utf8");
    const snapshot = await collectLocalDashboardSnapshot(directory);
    assert.deepEqual(snapshot.runs, [
      {
        runId: "typed-hostile",
        state: "invalid",
        error: "invalid_run_artifacts",
      },
    ]);
    assert.doesNotMatch(JSON.stringify(snapshot), /root|private|secret/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("local dashboard rejects malformed, missing, oversized, duplicate, private, and symlink artifacts", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "graph-dashboard-hostile-"));
  try {
    await writeFile(
      join(directory, "malformed.checkpoint.json"),
      "{",
      "utf8",
    );
    await writeFile(join(directory, "malformed.jsonl"), "{}\n", "utf8");

    await writeRun(directory, "missing-audit");
    await rm(join(directory, "missing-audit.jsonl"));

    await writeFile(
      join(directory, "oversized.checkpoint.json"),
      "x".repeat(2_000_001),
      "utf8",
    );
    await writeFile(join(directory, "oversized.jsonl"), "{}\n", "utf8");

    await writeRun(directory, "duplicate-a", {
      embeddedRunId: "shared-identity",
    });
    await writeRun(directory, "duplicate-b", {
      embeddedRunId: "shared-identity",
    });

    const outside = await mkdtemp(join(tmpdir(), "graph-dashboard-outside-"));
    await writeRun(outside, "linked");
    try {
      await symlink(
        join(outside, "linked.checkpoint.json"),
        join(directory, "linked.checkpoint.json"),
      );
      await symlink(
        join(outside, "linked.jsonl"),
        join(directory, "linked.jsonl"),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        t.diagnostic("symlink creation is not permitted on this host");
      } else {
        throw error;
      }
    }

    const snapshot = await collectLocalDashboardSnapshot(directory);
    const errors = Object.fromEntries(
      snapshot.runs.map((run) => [
        run.runId,
        run.state === "invalid" ? run.error : "unexpected-valid",
      ]),
    );
    assert.equal(errors.malformed, "invalid_run_artifacts");
    assert.equal(errors["missing-audit"], "missing_run_artifacts");
    assert.equal(errors.oversized, "oversized_run_artifacts");
    assert.equal(errors["duplicate-a"], "duplicate_run_identity");
    assert.equal(errors["duplicate-b"], "duplicate_run_identity");
    if (errors.linked !== undefined) {
      assert.equal(errors.linked, "symlink_run_artifacts");
    }
    assert.equal(isSafeDashboardRunId("../private"), false);
    assert.equal(isSafeDashboardRunId("C:\\private"), false);
    assert.equal(isSafeDashboardRunId("constructor"), false);
    await rm(outside, { recursive: true, force: true });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("local dashboard is loopback-only with fixed read-only routes and locked headers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "graph-dashboard-http-"));
  await writeRun(directory, "http-run");
  assert.throws(
    () =>
      startLocalDashboard({
        host: "0.0.0.0",
        port: 0,
        directory,
      }),
    /loopback/,
  );
  const server = startLocalDashboard({
    host: "127.0.0.1",
    port: 0,
    directory,
    now: 0,
  });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(
      page.headers.get("content-security-policy") ?? "",
      /default-src 'none'/,
    );
    assert.doesNotMatch(await page.text(), /http-run/);

    const snapshot = await fetch(`${base}/v1/dashboard`);
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.headers.get("cache-control"), "no-store");
    assert.equal((await snapshot.json()).runs[0].runId, "http-run");

    assert.equal((await fetch(`${base}/package.json`)).status, 404);
    assert.equal(
      (
        await fetch(`${base}/v1/dashboard`, {
          method: "POST",
          body: "{}",
        })
      ).status,
      405,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
