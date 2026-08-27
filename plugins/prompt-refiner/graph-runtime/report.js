import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { graphFingerprint } from "./runtime.js";
function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}
function selected(value, path) {
    let current = value;
    for (const segment of path.split(".")) {
        if (!current || typeof current !== "object")
            return undefined;
        current = current[segment];
    }
    return current;
}
function reasonCount(value) {
    if (!value || typeof value !== "object")
        return 0;
    const reasons = value.reasons;
    return Array.isArray(reasons) ? reasons.length : 0;
}
export async function createPortableRunReport(directory, runId) {
    const checkpointPath = resolve(directory, `${runId}.checkpoint.json`);
    const auditPath = resolve(directory, `${runId}.jsonl`);
    const [checkpointRaw, auditRaw] = await Promise.all([
        readFile(checkpointPath, "utf8"),
        readFile(auditPath, "utf8"),
    ]);
    return createPortableRunReportFromArtifacts(checkpointRaw, auditRaw, runId);
}
export function createPortableRunReportFromArtifacts(checkpointRaw, auditRaw, runId) {
    const checkpoint = JSON.parse(checkpointRaw);
    const events = auditRaw
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    if (checkpoint.runId !== runId) {
        throw new Error(`checkpoint run ID mismatch: expected ${runId}, found ${checkpoint.runId}`);
    }
    const auditSequenceVerified = events.length > 0 &&
        events.every((event, index) => event.sequence === index + 1 && event.runId === checkpoint.runId);
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
            integrityVerified: checkpoint.graphHash === graphFingerprint(checkpoint.graph),
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
//# sourceMappingURL=report.js.map