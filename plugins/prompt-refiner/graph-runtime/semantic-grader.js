import { readFile } from "node:fs/promises";
import { gradeCheckpoint } from "./grader.js";
import { loadCheckpoint } from "./persistence.js";
export async function loadSemanticCases(path) {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(value))
        throw new Error("semantic corpus must be an array");
    return value.map((entry, index) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            throw new Error(`semantic case ${index} must be an object`);
        }
        const item = entry;
        if (typeof item.id !== "string" ||
            typeof item.prompt !== "string" ||
            typeof item.forceGraph !== "boolean" ||
            !Array.isArray(item.expectedAll) ||
            !item.expectedAll.every((term) => typeof term === "string") ||
            (item.forbiddenAny !== undefined &&
                (!Array.isArray(item.forbiddenAny) ||
                    !item.forbiddenAny.every((term) => typeof term === "string")))) {
            throw new Error(`semantic case ${index} has invalid fields`);
        }
        return {
            id: item.id,
            prompt: item.prompt,
            forceGraph: item.forceGraph,
            expectedAll: item.expectedAll,
            ...(item.forbiddenAny
                ? { forbiddenAny: item.forbiddenAny }
                : {}),
        };
    });
}
export async function gradeSemanticCheckpoint(input) {
    const checkpoint = await loadCheckpoint(input.directory, input.runId);
    const artifact = await gradeCheckpoint(input.directory, input.runId);
    const candidateId = checkpoint.graph.repairPolicy?.candidateNodeId ??
        (checkpoint.outputs.synthesize !== undefined ? "synthesize" : "execute");
    const candidate = JSON.stringify(checkpoint.outputs[candidateId] ?? "");
    const normalized = candidate.toLocaleLowerCase("en");
    const expectedChecks = input.semanticCase.expectedAll.map((term) => ({
        id: `contains:${term}`,
        passed: normalized.includes(term.toLocaleLowerCase("en")),
        detail: `candidate must contain ${JSON.stringify(term)}`,
    }));
    const forbiddenChecks = (input.semanticCase.forbiddenAny ?? []).map((term) => ({
        id: `forbids:${term}`,
        passed: !normalized.includes(term.toLocaleLowerCase("en")),
        detail: `candidate must not contain ${JSON.stringify(term)}`,
    }));
    const checks = [
        {
            id: "artifact-grade",
            passed: artifact.passed,
            detail: `artifact score ${artifact.score}`,
        },
        {
            id: "routing",
            passed: checkpoint.graph.metadata.routing ===
                (input.semanticCase.forceGraph ? "graph" : "direct"),
            detail: `expected ${input.semanticCase.forceGraph ? "graph" : "direct"} routing`,
        },
        ...expectedChecks,
        ...forbiddenChecks,
    ];
    const passedCount = checks.filter((check) => check.passed).length;
    return {
        caseId: input.semanticCase.id,
        runId: input.runId,
        passed: passedCount === checks.length,
        score: passedCount / checks.length,
        artifactScore: artifact.score,
        checks,
    };
}
//# sourceMappingURL=semantic-grader.js.map