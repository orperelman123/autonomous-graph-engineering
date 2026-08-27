import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { validatedOutput } from "./output-schema.js";
import { CheckpointStore, JsonlEventStore } from "./persistence.js";
import { executionIdempotencyKey, reconciliationToken, } from "./reconciliation.js";
import { validateGraph } from "./validator.js";
function getPath(value, path) {
    if (!path)
        return value;
    let current = value;
    for (const segment of path.split(".")) {
        if (!current || typeof current !== "object")
            return undefined;
        current = current[segment];
    }
    return current;
}
function asItems(value, path) {
    const selected = getPath(value, path);
    if (Array.isArray(selected))
        return selected;
    if (selected &&
        typeof selected === "object" &&
        Array.isArray(selected.items)) {
        return selected.items;
    }
    return selected === undefined ? [] : [selected];
}
function stableKey(value) {
    const seen = new WeakSet();
    const canonicalize = (current) => {
        if (current === undefined)
            return { $type: "undefined" };
        if (typeof current === "bigint") {
            return { $type: "bigint", value: current.toString() };
        }
        if (current === null ||
            typeof current === "string" ||
            typeof current === "boolean" ||
            typeof current === "number") {
            return current;
        }
        if (Array.isArray(current)) {
            if (seen.has(current))
                throw new Error("cannot deduplicate cyclic output");
            seen.add(current);
            const result = current.map(canonicalize);
            seen.delete(current);
            return result;
        }
        if (typeof current === "object") {
            if (seen.has(current))
                throw new Error("cannot deduplicate cyclic output");
            seen.add(current);
            const result = Object.fromEntries(Object.entries(current)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, child]) => [key, canonicalize(child)]));
            seen.delete(current);
            return result;
        }
        return { $type: typeof current, value: String(current) };
    };
    return JSON.stringify(canonicalize(value));
}
function combinedUsage(...values) {
    const result = {};
    for (const value of values) {
        if (!value)
            continue;
        for (const field of [
            "inputTokens",
            "cachedInputTokens",
            "cacheCreationInputTokens",
            "outputTokens",
            "reasoningOutputTokens",
            "costUsd",
        ]) {
            const amount = value[field];
            if (amount !== undefined)
                result[field] = (result[field] ?? 0) + amount;
        }
    }
    return result;
}
class UsageBudgetExceededError extends Error {
}
function usageExceedsBudget(graph, usage) {
    const consumed = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
    const budget = graph.budgets.maxActualTokens ?? graph.budgets.maxEstimatedTokens;
    return consumed > budget;
}
function assertUsageBudget(graph, usage) {
    if (!usageExceedsBudget(graph, usage))
        return;
    const consumed = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
    const budget = graph.budgets.maxActualTokens ?? graph.budgets.maxEstimatedTokens;
    throw new UsageBudgetExceededError(`actual token use ${consumed} exceeds maxActualTokens ${budget}`);
}
export function graphFingerprint(graph) {
    return createHash("sha256").update(stableKey(graph)).digest("hex");
}
export function graphApprovalToken(graph, gateId) {
    return `${graph.id}:${graphFingerprint(graph).slice(0, 16)}:${gateId}`;
}
function deterministic(node, input) {
    const values = input && typeof input === "object"
        ? Object.values(input)
        : [input];
    switch (node.operation) {
        case "identity":
            return values[0];
        case "collect":
            return values;
        case "flatten":
            return values.flatMap((value) => (Array.isArray(value) ? value : [value]));
        case "dedupe": {
            const flat = values.flatMap((value) => Array.isArray(value) ? value : [value]);
            const seen = new Set();
            return flat.filter((value) => {
                const key = stableKey(value);
                if (seen.has(key))
                    return false;
                seen.add(key);
                return true;
            });
        }
        default:
            return values.length === 1 ? values[0] : values;
    }
}
async function mapLimit(values, limit, mapper) {
    const results = new Array(values.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(Math.max(1, limit), Math.max(1, values.length)) }, async () => {
        while (cursor < values.length) {
            const index = cursor++;
            const value = values[index];
            if (value === undefined)
                continue;
            results[index] = await mapper(value, index);
        }
    });
    await Promise.all(workers);
    return results;
}
function createLimiter(limit) {
    let active = 0;
    const waiting = [];
    const acquire = async () => {
        if (active < limit) {
            active += 1;
            return;
        }
        await new Promise((resolve) => waiting.push(resolve));
        active += 1;
    };
    const release = () => {
        active -= 1;
        waiting.shift()?.();
    };
    return async (task) => {
        await acquire();
        try {
            return await task();
        }
        finally {
            release();
        }
    };
}
function executorFor(node, options) {
    if (!node.executor)
        throw new Error(`node ${node.id} has no executor`);
    const executor = options.executors[node.executor];
    if (!executor) {
        throw new Error(`executor is unavailable: ${node.executor}`);
    }
    return executor;
}
async function invokeExecutor(executor, request) {
    const controller = new AbortController();
    let timeout;
    const execution = executor.execute({ ...request, signal: controller.signal });
    const watchdog = new Promise((_, reject) => {
        timeout = setTimeout(() => {
            controller.abort();
            reject(new ExecutorTimeoutError(request.nodeId));
        }, request.timeoutMs);
    });
    try {
        return await Promise.race([execution, watchdog]);
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
    }
}
class ExecutorTimeoutError extends Error {
    nodeId;
    constructor(nodeId) {
        super(`executor timed out for node ${nodeId}`);
        this.nodeId = nodeId;
    }
}
function dependencyInput(node, outputs) {
    return Object.fromEntries(node.dependsOn.map((dependency) => [dependency, outputs[dependency]]));
}
async function executeNode(graph, node, runId, outputs, options, timeoutMs, runLimited, attemptId) {
    const input = dependencyInput(node, outputs);
    if (node.kind === "deterministic" || node.kind === "reduce") {
        return { output: validatedOutput(node, deterministic(node, input)) };
    }
    if (node.kind === "human_gate") {
        const approvalToken = graphApprovalToken(graph, node.id);
        if (!(options.approvals ?? []).includes(approvalToken)) {
            throw new HumanGateRequired(node.id, approvalToken);
        }
        return {
            output: validatedOutput(node, {
                approved: true,
                gateId: node.id,
                approvalToken,
            }),
        };
    }
    const executor = executorFor(node, options);
    if (node.kind === "parallel_map") {
        const dependencyValue = node.dependsOn.length === 1 ? outputs[node.dependsOn[0] ?? ""] : input;
        const items = asItems(dependencyValue, node.inputPath);
        if (items.length > graph.budgets.maxFanout) {
            throw new Error(`node ${node.id} fan-out ${items.length} exceeds maxFanout ${graph.budgets.maxFanout}`);
        }
        const executions = await mapLimit(items, node.maxConcurrency ?? graph.budgets.maxParallel, async (item, index) => {
            const execution = await runLimited(() => invokeExecutor(executor, {
                runId,
                nodeId: `${node.id}:${index}`,
                label: `${node.label} ${index + 1}/${items.length}`,
                prompt: node.prompt ?? node.label,
                permission: node.permission,
                input: { goal: graph.goal, item },
                ...(node.outputSchema ? { outputSchema: node.outputSchema } : {}),
                cwd: options.cwd ?? process.cwd(),
                timeoutMs,
                ...(attemptId ? { attemptId: `${attemptId}:${index}` } : {}),
                ...(node.permission !== "none" && node.permission !== "read"
                    ? {
                        idempotencyKey: executionIdempotencyKey(runId, `${node.id}:${index}`),
                    }
                    : {}),
            }));
            return {
                output: validatedOutput(node, execution.output),
                usage: execution.usage,
            };
        });
        return {
            output: executions.map((execution) => execution.output),
            usage: combinedUsage(...executions.map((execution) => execution.usage)),
        };
    }
    const request = {
        runId,
        nodeId: node.id,
        label: node.label,
        prompt: node.prompt ?? node.label,
        permission: node.permission,
        input: { goal: graph.goal, dependencies: input },
        ...(node.outputSchema ? { outputSchema: node.outputSchema } : {}),
        cwd: options.cwd ?? process.cwd(),
        timeoutMs,
        ...(attemptId ? { attemptId } : {}),
        ...(node.permission !== "none" && node.permission !== "read"
            ? { idempotencyKey: executionIdempotencyKey(runId, node.id) }
            : {}),
    };
    const execution = await runLimited(() => invokeExecutor(executor, request));
    return {
        output: validatedOutput(node, execution.output),
        ...(execution.usage ? { usage: execution.usage } : {}),
    };
}
class HumanGateRequired extends Error {
    nodeId;
    approvalToken;
    constructor(nodeId, approvalToken) {
        super(`human confirmation required for gate ${nodeId}`);
        this.nodeId = nodeId;
        this.approvalToken = approvalToken;
    }
}
function accepted(value, field) {
    const selected = getPath(value, field);
    return selected === true;
}
export async function runGraph(graph, options) {
    const validation = validateGraph(graph);
    if (!validation.valid) {
        throw new Error(`invalid graph: ${validation.errors.map((issue) => issue.code).join(", ")}`);
    }
    const now = options.now ?? (() => new Date());
    const startedAt = options.resume?.startedAt ?? now().toISOString();
    if (graph.autonomy === "plan_only") {
        return {
            runId: randomUUID(),
            graphId: graph.id,
            status: "plan_only",
            outputs: {},
            nodes: {},
            repairRounds: 0,
            usage: {},
            startedAt,
            completedAt: now().toISOString(),
        };
    }
    const graphHash = graphFingerprint(graph);
    const resume = options.resume;
    if (resume) {
        if (resume.version !== "1.0" ||
            resume.graph.id !== graph.id ||
            resume.graphHash !== graphFingerprint(resume.graph) ||
            resume.graphHash !== graphHash) {
            throw new Error("checkpoint graph fingerprint mismatch");
        }
        const byId = new Map(graph.nodes.map((node) => [node.id, node]));
        if (resume.status !== "completed") {
            for (const [nodeId, state] of Object.entries(resume.nodes)) {
                const node = byId.get(nodeId);
                if (node?.kind !== "human_gate" || state.state !== "completed")
                    continue;
                const approvalToken = graphApprovalToken(graph, nodeId);
                const expectedOutput = {
                    approved: true,
                    gateId: nodeId,
                    approvalToken,
                };
                if (!(options.approvals ?? []).includes(approvalToken) ||
                    stableKey(resume.outputs[nodeId]) !== stableKey(expectedOutput)) {
                    throw new Error(`completed gate ${nodeId} requires its approval token again when resuming`);
                }
            }
        }
        const uncertain = Object.values(resume.nodes).find((state) => {
            const permission = byId.get(state.nodeId)?.permission;
            return ((state.state === "running" || state.state === "failed") &&
                permission !== undefined &&
                permission !== "none" &&
                permission !== "read");
        });
        if (uncertain) {
            const token = reconciliationToken(resume.runId, resume.graphHash, uncertain.nodeId);
            throw new Error(`cannot automatically resume uncertain side-effecting node ${uncertain.nodeId}; reconcile it with token ${token}`);
        }
    }
    const runId = resume?.runId ?? randomUUID();
    const deadline = Date.now() + graph.budgets.timeoutMs;
    const auditDirectory = options.auditDirectory ?? resolve(options.cwd ?? process.cwd(), ".graph-runs");
    const store = new JsonlEventStore(auditDirectory, runId, resume?.eventSequence ?? 0);
    const checkpointStore = new CheckpointStore(auditDirectory, runId);
    const resumeOverBudget = resume !== undefined && usageExceedsBudget(graph, resume.usage);
    const nodes = resume
        ? Object.fromEntries(graph.nodes.map((node) => {
            const prior = resume.nodes[node.id];
            if (prior?.state === "completed") {
                return [node.id, { ...prior }];
            }
            if (prior && resumeOverBudget) {
                const { output: _rejectedOutput, ...preserved } = prior;
                return [
                    node.id,
                    {
                        ...preserved,
                        ...(prior.state === "failed"
                            ? { failureKind: "budget" }
                            : {}),
                    },
                ];
            }
            return [
                node.id,
                {
                    nodeId: node.id,
                    state: "pending",
                    ...(prior?.usage ? { usage: { ...prior.usage } } : {}),
                },
            ];
        }))
        : Object.fromEntries(graph.nodes.map((node) => [
            node.id,
            { nodeId: node.id, state: "pending" },
        ]));
    const outputs = Object.fromEntries(Object.entries(resume?.outputs ?? {}).filter(([nodeId]) => nodes[nodeId]?.state === "completed"));
    let usage = { ...(resume?.usage ?? {}) };
    const runLimited = createLimiter(graph.budgets.maxParallel);
    let repairRounds = resume?.repairRounds ?? 0;
    const saveCheckpoint = async (status) => {
        await checkpointStore.save({
            version: "1.0",
            graph,
            graphHash,
            runId,
            status,
            outputs,
            nodes,
            repairRounds,
            usage,
            startedAt,
            updatedAt: now().toISOString(),
            eventSequence: store.sequence,
            reconciliations: resume?.reconciliations ?? [],
        });
    };
    if (resume?.status === "completed") {
        return {
            runId,
            graphId: graph.id,
            status: "completed",
            outputs,
            nodes,
            repairRounds,
            usage,
            startedAt,
            completedAt: resume.updatedAt,
            auditPath: store.path,
            checkpointPath: checkpointStore.path,
        };
    }
    await store.append({
        runId,
        type: resume ? "run_resumed" : "run_started",
        data: { graphId: graph.id },
    }, now());
    await saveCheckpoint("running");
    try {
        // A checkpoint that has already exhausted its immutable graph budget must
        // not replay provider work. Preserve its failed node state and accounting,
        // while filtering any legacy output that was recorded before budget
        // validation became atomic.
        assertUsageBudget(graph, usage);
        const pending = new Set(validation.topologicalOrder.filter((nodeId) => nodes[nodeId]?.state !== "completed"));
        while (pending.size > 0) {
            const ready = validation.topologicalOrder.filter((nodeId) => {
                if (!pending.has(nodeId))
                    return false;
                const node = graph.nodes.find((item) => item.id === nodeId);
                return node?.dependsOn.every((dependency) => nodes[dependency]?.state === "completed");
            });
            if (ready.length === 0) {
                for (const nodeId of pending) {
                    const state = nodes[nodeId];
                    if (state)
                        state.state = "skipped";
                }
                throw new Error("no executable nodes remain");
            }
            const batch = ready.slice(0, graph.budgets.maxParallel);
            const outcomes = await Promise.all(batch.map(async (nodeId) => {
                const node = graph.nodes.find((item) => item.id === nodeId);
                const state = nodes[nodeId];
                if (!node || !state) {
                    return { nodeId, error: new Error(`node missing: ${nodeId}`) };
                }
                state.state = "running";
                state.startedAt = now().toISOString();
                state.attemptId = randomUUID();
                if (node.permission !== "none" && node.permission !== "read") {
                    state.idempotencyKey ??= executionIdempotencyKey(runId, node.id);
                }
                await store.append({ runId, type: "node_started", nodeId: node.id }, now());
                await saveCheckpoint("running");
                try {
                    const remainingMs = deadline - Date.now();
                    if (remainingMs <= 0)
                        throw new Error("graph execution timed out");
                    const execution = await executeNode(graph, node, runId, outputs, options, remainingMs, runLimited, state.attemptId);
                    usage = combinedUsage(usage, execution.usage);
                    if (execution.usage) {
                        state.usage = combinedUsage(state.usage, execution.usage);
                    }
                    assertUsageBudget(graph, usage);
                    outputs[node.id] = execution.output;
                    state.state = "completed";
                    state.output = outputs[node.id];
                    state.completedAt = now().toISOString();
                    await store.append({
                        runId,
                        type: "node_completed",
                        nodeId: node.id,
                        data: { output: outputs[node.id] },
                    }, now());
                    await saveCheckpoint("running");
                    return { nodeId };
                }
                catch (error) {
                    state.completedAt = now().toISOString();
                    if (error instanceof HumanGateRequired) {
                        state.state = "blocked";
                        state.error = error.message;
                        await store.append({
                            runId,
                            type: "node_blocked",
                            nodeId: node.id,
                            data: { reason: error.message },
                        }, now());
                        await saveCheckpoint("running");
                        return {
                            nodeId,
                            gateId: node.id,
                            approvalToken: error.approvalToken,
                        };
                    }
                    state.state = "failed";
                    state.error = error.message;
                    state.failureKind =
                        error instanceof UsageBudgetExceededError
                            ? "budget"
                            : error instanceof ExecutorTimeoutError ||
                                /timed out/i.test(state.error)
                                ? "timeout"
                                : "executor";
                    await store.append({
                        runId,
                        type: "node_failed",
                        nodeId: node.id,
                        data: {
                            error: state.error,
                            failureKind: state.failureKind,
                            ...(state.idempotencyKey
                                ? { idempotencyKey: state.idempotencyKey }
                                : {}),
                        },
                    }, now());
                    await saveCheckpoint("running");
                    return { nodeId, error };
                }
            }));
            batch.forEach((nodeId) => pending.delete(nodeId));
            const gate = outcomes.find((outcome) => "gateId" in outcome &&
                typeof outcome.gateId === "string" &&
                typeof outcome.approvalToken === "string");
            if (gate) {
                await store.append({ runId, type: "run_blocked", data: { gateId: gate.gateId } }, now());
                await saveCheckpoint("needs_confirmation");
                return {
                    runId,
                    graphId: graph.id,
                    status: "needs_confirmation",
                    outputs,
                    nodes,
                    repairRounds,
                    usage,
                    startedAt,
                    completedAt: now().toISOString(),
                    auditPath: store.path,
                    checkpointPath: checkpointStore.path,
                    confirmation: {
                        gateId: gate.gateId,
                        approvalToken: gate.approvalToken,
                    },
                };
            }
            const failure = outcomes.find((outcome) => outcome.error);
            if (failure?.error)
                throw failure.error;
        }
        const policy = graph.repairPolicy;
        if (policy) {
            const candidateNode = graph.nodes.find((node) => node.id === policy.candidateNodeId);
            if (!candidateNode)
                throw new Error("repair candidate missing");
            let verifierOutput = outputs[policy.verifierNodeId];
            let candidate = outputs[policy.candidateNodeId];
            while (policy.enabled &&
                !accepted(verifierOutput, policy.acceptedField) &&
                repairRounds < graph.budgets.maxRepairRounds) {
                const remainingMs = deadline - Date.now();
                if (remainingMs <= 0)
                    throw new Error("graph execution timed out");
                repairRounds += 1;
                await store.append({
                    runId,
                    type: "repair_started",
                    data: { round: repairRounds },
                }, now());
                await saveCheckpoint("running");
                const repairExecutor = options.executors[policy.repairExecutor];
                if (!repairExecutor) {
                    throw new Error(`repair executor unavailable: ${policy.repairExecutor}`);
                }
                const repairExecution = await runLimited(() => invokeExecutor(repairExecutor, {
                    runId,
                    nodeId: `repair:${repairRounds}`,
                    label: `Repair round ${repairRounds}`,
                    prompt: policy.repairPrompt,
                    permission: candidateNode.permission,
                    input: { goal: graph.goal, candidate, verifierOutput },
                    ...(candidateNode.outputSchema
                        ? { outputSchema: candidateNode.outputSchema }
                        : {}),
                    cwd: options.cwd ?? process.cwd(),
                    timeoutMs: remainingMs,
                    iteration: repairRounds,
                }));
                usage = combinedUsage(usage, repairExecution.usage);
                const candidateState = nodes[policy.candidateNodeId];
                if (candidateState && repairExecution.usage) {
                    candidateState.usage = combinedUsage(candidateState.usage, repairExecution.usage);
                }
                assertUsageBudget(graph, usage);
                candidate = validatedOutput(candidateNode, repairExecution.output);
                const verifierNode = graph.nodes.find((node) => node.id === policy.verifierNodeId);
                if (!verifierNode)
                    throw new Error("repair verifier missing");
                const verifierExecutor = executorFor(verifierNode, options);
                const verifyExecution = await runLimited(() => invokeExecutor(verifierExecutor, {
                    runId,
                    nodeId: `reverify:${repairRounds}`,
                    label: `Reverify round ${repairRounds}`,
                    prompt: verifierNode.prompt ?? verifierNode.label,
                    permission: "read",
                    input: { goal: graph.goal, candidate },
                    cwd: options.cwd ?? process.cwd(),
                    timeoutMs: Math.max(1, deadline - Date.now()),
                    iteration: repairRounds,
                }));
                usage = combinedUsage(usage, verifyExecution.usage);
                const verifierState = nodes[policy.verifierNodeId];
                if (verifierState && verifyExecution.usage) {
                    verifierState.usage = combinedUsage(verifierState.usage, verifyExecution.usage);
                }
                assertUsageBudget(graph, usage);
                verifierOutput = validatedOutput(verifierNode, verifyExecution.output);
                outputs[policy.candidateNodeId] = candidate;
                outputs[policy.verifierNodeId] = verifierOutput;
                if (candidateState) {
                    candidateState.output = candidate;
                    candidateState.completedAt = now().toISOString();
                }
                if (verifierState) {
                    verifierState.output = verifierOutput;
                    verifierState.completedAt = now().toISOString();
                }
                await store.append({
                    runId,
                    type: "repair_completed",
                    data: {
                        round: repairRounds,
                        accepted: accepted(verifierOutput, policy.acceptedField),
                        candidate,
                        verifierOutput,
                    },
                }, now());
            }
            if (!accepted(verifierOutput, policy.acceptedField)) {
                throw new Error("acceptance criteria failed after repair budget");
            }
        }
        await store.append({ runId, type: "run_completed" }, now());
        await saveCheckpoint("completed");
        return {
            runId,
            graphId: graph.id,
            status: "completed",
            outputs,
            nodes,
            repairRounds,
            usage,
            startedAt,
            completedAt: now().toISOString(),
            auditPath: store.path,
            checkpointPath: checkpointStore.path,
        };
    }
    catch (error) {
        await store.append({
            runId,
            type: "run_failed",
            data: { error: error.message },
        }, now());
        await saveCheckpoint("failed");
        return {
            runId,
            graphId: graph.id,
            status: "failed",
            outputs,
            nodes,
            repairRounds,
            usage,
            startedAt,
            completedAt: now().toISOString(),
            auditPath: store.path,
            checkpointPath: checkpointStore.path,
            error: error.message,
        };
    }
}
//# sourceMappingURL=runtime.js.map