#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { renderDoctorReport, runDoctor } from "./doctor.js";
import { runGraphEvaluation } from "./evaluation.js";
import { gradeCheckpoint } from "./grader.js";
import { loadCheckpoint } from "./persistence.js";
import { createPortableRunReport } from "./report.js";
import {
  reconcileCheckpoint,
  reconciliationNeeds,
} from "./reconciliation.js";
import {
  gradeSemanticCheckpoint,
  loadSemanticCases,
} from "./semantic-grader.js";
import { defaultExecutors } from "./security.js";
import { planGraph } from "./planner.js";
import { runGraph } from "./runtime.js";
import { startGraphServer } from "./server.js";
import type {
  AutonomyLevel,
  GraphSpec,
  PlanGraphRequest,
} from "./types.js";
import { validateGraph } from "./validator.js";

function usage(): never {
  process.stderr.write(`Usage:
  graph-engineer plan [--autonomy level] [--executor codex|claude|local] [--verifier codex|claude|local] [--force-graph] <prompt>
  graph-engineer doctor [--json] [--root <path>] [--plugin-dir <path>]
  graph-engineer validate <graph.json>
  graph-engineer run [--autonomy level] [--executor codex|claude|local] [--verifier codex|claude|local] [--approve graph-id:fingerprint:gate-id] <prompt>
  graph-engineer run-file [--approve graph-id:fingerprint:gate-id] <graph.json>
  graph-engineer resume [--approve graph-id:fingerprint:gate-id] <run-id>
  graph-engineer inspect <run-id>
  graph-engineer report <run-id>
  graph-engineer reconcile <run-id> <node-id> --token <token> --outcome completed|not_applied --evidence <text> [--output-json <json>] [--termination-json <json>]
  graph-engineer grade <run-id>
  graph-engineer semantic-grade <run-id> <corpus.json> <case-id>
  graph-engineer eval
  graph-engineer serve [port]
`);
  process.exit(1);
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function promptArgs(args: string[]): string[] {
  const consumesValue = new Set([
    "--autonomy",
    "--executor",
    "--verifier",
    "--approve",
  ]);
  const result: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value) continue;
    if (consumesValue.has(value)) {
      index += 1;
      continue;
    }
    if (value.startsWith("--")) continue;
    result.push(value);
  }
  return result;
}

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;
  if (!command) usage();
  const configuredAuditDirectory =
    process.env.GRAPH_ENGINEER_AUDIT_DIRECTORY;
  if (command === "doctor") {
    const root = option(args, "--root");
    const pluginDirectory = option(args, "--plugin-dir");
    const report = await runDoctor({
      ...(root ? { root } : {}),
      ...(pluginDirectory ? { pluginDirectory } : {}),
    });
    process.stdout.write(
      args.includes("--json")
        ? `${JSON.stringify(report, null, 2)}\n`
        : renderDoctorReport(report),
    );
    process.exitCode = report.status === "ready" ? 0 : 1;
    return;
  }
  if (command === "eval") {
    const report = await runGraphEvaluation();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.failed ? 1 : 0;
    return;
  }
  if (command === "serve") {
    const port = args[0] ? Number(args[0]) : undefined;
    const server = startGraphServer(port ? { port } : {});
    server.on("listening", () => {
      const address = server.address();
      process.stderr.write(
        `graph-engineer listening on ${typeof address === "object" && address ? address.port : port}\n`,
      );
    });
    return;
  }
  if (command === "grade") {
    if (!args[0]) usage();
    const directory = process.env.GRAPH_ENGINEER_AUDIT_DIRECTORY ?? ".graph-runs";
    const grade = await gradeCheckpoint(directory, args[0]);
    process.stdout.write(`${JSON.stringify(grade, null, 2)}\n`);
    process.exitCode = grade.passed ? 0 : 1;
    return;
  }
  if (command === "semantic-grade") {
    const [runId, corpusPath, caseId] = args;
    if (!runId || !corpusPath || !caseId) usage();
    const cases = await loadSemanticCases(corpusPath);
    const semanticCase = cases.find((item) => item.id === caseId);
    if (!semanticCase) throw new Error(`semantic case not found: ${caseId}`);
    const directory = process.env.GRAPH_ENGINEER_AUDIT_DIRECTORY ?? ".graph-runs";
    const grade = await gradeSemanticCheckpoint({
      directory,
      runId,
      semanticCase,
    });
    process.stdout.write(`${JSON.stringify(grade, null, 2)}\n`);
    process.exitCode = grade.passed ? 0 : 1;
    return;
  }
  if (command === "inspect") {
    if (!args[0]) usage();
    const directory = process.env.GRAPH_ENGINEER_AUDIT_DIRECTORY ?? ".graph-runs";
    const checkpoint = await loadCheckpoint(directory, args[0]);
    process.stdout.write(
      `${JSON.stringify(
        {
          runId: checkpoint.runId,
          status: checkpoint.status,
          graphId: checkpoint.graph.id,
          updatedAt: checkpoint.updatedAt,
          usage: checkpoint.usage,
          reconciliationRequired: reconciliationNeeds(checkpoint),
          reconciliations: checkpoint.reconciliations ?? [],
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (command === "report") {
    if (!args[0]) usage();
    const directory = process.env.GRAPH_ENGINEER_AUDIT_DIRECTORY ?? ".graph-runs";
    const report = await createPortableRunReport(directory, args[0]);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  if (command === "reconcile") {
    const [runId, nodeId] = args;
    const token = option(args, "--token");
    const outcome = option(args, "--outcome");
    const evidence = option(args, "--evidence");
    const outputJson = option(args, "--output-json");
    const terminationJson = option(args, "--termination-json");
    if (
      !runId ||
      !nodeId ||
      !token ||
      !evidence ||
      (outcome !== "completed" && outcome !== "not_applied")
    ) {
      usage();
    }
    const directory = process.env.GRAPH_ENGINEER_AUDIT_DIRECTORY ?? ".graph-runs";
    const checkpoint = await reconcileCheckpoint({
      directory,
      runId,
      nodeId,
      token,
      outcome,
      evidence,
      ...(outputJson !== undefined
        ? { output: JSON.parse(outputJson) as unknown }
        : {}),
      ...(terminationJson !== undefined
        ? {
            terminationEvidence: JSON.parse(terminationJson) as {
              attemptId: string;
              executor: string;
              observedAt: string;
              method: string;
              status: "terminated";
            },
          }
        : {}),
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          runId: checkpoint.runId,
          status: checkpoint.status,
          node: checkpoint.nodes[nodeId],
          reconciliation: checkpoint.reconciliations?.at(-1),
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (command === "validate") {
    if (!args[0]) usage();
    const graph = JSON.parse(await readFile(args[0], "utf8")) as GraphSpec;
    const validation = validateGraph(graph);
    process.stdout.write(`${JSON.stringify(validation, null, 2)}\n`);
    process.exitCode = validation.valid ? 0 : 1;
    return;
  }

  const autonomy =
    (option(args, "--autonomy") as AutonomyLevel | undefined) ?? "read_only";
  const executor =
    (option(args, "--executor") as "codex" | "claude" | "local" | undefined) ??
    "codex";
  const verifier =
    (option(args, "--verifier") as "codex" | "claude" | "local" | undefined) ??
    executor;
  const approvals = args.flatMap((value, index) =>
    value === "--approve" && args[index + 1] ? [args[index + 1] as string] : [],
  );

  let graph: GraphSpec;
  let resume;
  if (command === "resume") {
    const runId = promptArgs(args)[0];
    if (!runId) usage();
    const directory = process.env.GRAPH_ENGINEER_AUDIT_DIRECTORY ?? ".graph-runs";
    resume = await loadCheckpoint(directory, runId);
    graph = resume.graph;
  } else if (command === "run-file") {
    const file = promptArgs(args)[0];
    if (!file) usage();
    graph = JSON.parse(await readFile(file, "utf8")) as GraphSpec;
  } else {
    const prompt = promptArgs(args).join(" ");
    if (!prompt) usage();
    const request: PlanGraphRequest = {
      prompt,
      autonomy,
      primaryExecutor: executor,
      verifierExecutor: verifier,
      forceGraph: args.includes("--force-graph"),
    };
    graph = planGraph(request);
  }

  if (command === "plan") {
    process.stdout.write(`${JSON.stringify(graph, null, 2)}\n`);
    return;
  }
  if (command !== "run" && command !== "run-file" && command !== "resume") {
    usage();
  }
  const result = await runGraph(graph, {
    executors: defaultExecutors(),
    approvals,
    ...(resume ? { resume } : {}),
    ...(configuredAuditDirectory
      ? { auditDirectory: configuredAuditDirectory }
      : {}),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode =
    result.status === "completed" || result.status === "plan_only"
      ? 0
      : result.status === "needs_confirmation"
        ? 2
        : 1;
}

void main().catch((error) => {
  process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
  process.exitCode = 1;
});
