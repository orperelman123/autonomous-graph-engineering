import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { lstat, readFile, readdir, realpath, } from "node:fs/promises";
import { join, sep } from "node:path";
import { createPortableRunReportFromArtifacts } from "./report.js";
const MAX_RUNS = 100;
const MAX_CHECKPOINT_BYTES = 2_000_000;
const MAX_AUDIT_BYTES = 5_000_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1_000;
const RUN_ID = /^(?!(?:constructor|prototype)$)[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export function isSafeDashboardRunId(value) {
    return RUN_ID.test(value);
}
function displayRunId(value) {
    return isSafeDashboardRunId(value)
        ? value
        : `invalid-${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}
function isLoopback(host) {
    return host === "127.0.0.1" || host === "::1" || host === "localhost";
}
function within(root, candidate) {
    return candidate === root || candidate.startsWith(`${root}${sep}`);
}
async function readBoundedRegularFile(root, path, maximumBytes) {
    const before = await lstat(path);
    if (before.isSymbolicLink())
        throw new Error("symlink_run_artifacts");
    if (!before.isFile())
        throw new Error("invalid_run_artifacts");
    if (before.size > maximumBytes)
        throw new Error("oversized_run_artifacts");
    const resolved = await realpath(path);
    if (!within(root, resolved))
        throw new Error("invalid_run_artifacts");
    const value = await readFile(resolved, "utf8");
    if (Buffer.byteLength(value, "utf8") > maximumBytes) {
        throw new Error("oversized_run_artifacts");
    }
    const after = await lstat(path);
    if (after.isSymbolicLink() ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs) {
        throw new Error("invalid_run_artifacts");
    }
    return value;
}
function errorCode(error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "symlink_run_artifacts")
        return message;
    if (message === "oversized_run_artifacts")
        return message;
    if (error?.code === "ENOENT") {
        return "missing_run_artifacts";
    }
    return "invalid_run_artifacts";
}
async function inspectCandidate(root, directory, filenameRunId) {
    if (!isSafeDashboardRunId(filenameRunId)) {
        return { filenameRunId, error: "invalid_run_artifacts" };
    }
    try {
        const checkpointRaw = await readBoundedRegularFile(root, join(directory, `${filenameRunId}.checkpoint.json`), MAX_CHECKPOINT_BYTES);
        const auditRaw = await readBoundedRegularFile(root, join(directory, `${filenameRunId}.jsonl`), MAX_AUDIT_BYTES);
        const checkpoint = JSON.parse(checkpointRaw);
        return {
            filenameRunId,
            checkpointRaw,
            auditRaw,
            ...(typeof checkpoint.runId === "string"
                ? { embeddedRunId: checkpoint.runId }
                : { error: "invalid_run_artifacts" }),
        };
    }
    catch (error) {
        return { filenameRunId, error: errorCode(error) };
    }
}
function validSummary(report, now, staleAfterMs) {
    const updatedAt = Date.parse(report.execution.updatedAt);
    const statuses = new Set([
        "running",
        "completed",
        "failed",
        "needs_confirmation",
    ]);
    if (!statuses.has(report.status) ||
        !Number.isFinite(updatedAt) ||
        !/^[a-f0-9]{64}$/.test(report.graph.fingerprint) ||
        !Number.isInteger(report.execution.repairRounds) ||
        report.execution.repairRounds < 0) {
        throw new Error("invalid_run_artifacts");
    }
    const budgetKeys = new Set([
        "maxNodes",
        "maxParallel",
        "maxFanout",
        "maxDepth",
        "maxRepairRounds",
        "timeoutMs",
        "maxEstimatedTokens",
        "maxActualTokens",
    ]);
    const budgets = report.graph.budgets;
    if (Object.keys(budgets).some((key) => !budgetKeys.has(key)) ||
        [
            "maxNodes",
            "maxParallel",
            "maxFanout",
            "maxDepth",
            "timeoutMs",
            "maxEstimatedTokens",
        ].some((key) => !Number.isInteger(budgets[key]) || Number(budgets[key]) < 1) ||
        !Number.isInteger(budgets.maxRepairRounds) ||
        Number(budgets.maxRepairRounds) < 0 ||
        (budgets.maxActualTokens !== undefined &&
            (!Number.isInteger(budgets.maxActualTokens) ||
                Number(budgets.maxActualTokens) < 1))) {
        throw new Error("invalid_run_artifacts");
    }
    const safeBudgets = {
        maxNodes: Number(budgets.maxNodes),
        maxParallel: Number(budgets.maxParallel),
        maxFanout: Number(budgets.maxFanout),
        maxDepth: Number(budgets.maxDepth),
        maxRepairRounds: Number(budgets.maxRepairRounds),
        timeoutMs: Number(budgets.timeoutMs),
        maxEstimatedTokens: Number(budgets.maxEstimatedTokens),
        ...(budgets.maxActualTokens === undefined
            ? {}
            : { maxActualTokens: Number(budgets.maxActualTokens) }),
    };
    const usageKeys = new Set([
        "inputTokens",
        "cachedInputTokens",
        "cacheCreationInputTokens",
        "outputTokens",
        "reasoningOutputTokens",
        "costUsd",
    ]);
    const usage = report.execution.usage;
    if (Object.keys(usage).some((key) => !usageKeys.has(key)) ||
        Object.entries(usage).some(([key, value]) => key === "costUsd"
            ? typeof value !== "number" ||
                !Number.isFinite(value) ||
                value < 0
            : !Number.isInteger(value) || Number(value) < 0)) {
        throw new Error("invalid_run_artifacts");
    }
    const safeUsage = {
        ...(usage.inputTokens === undefined
            ? {}
            : { inputTokens: Number(usage.inputTokens) }),
        ...(usage.cachedInputTokens === undefined
            ? {}
            : { cachedInputTokens: Number(usage.cachedInputTokens) }),
        ...(usage.cacheCreationInputTokens === undefined
            ? {}
            : {
                cacheCreationInputTokens: Number(usage.cacheCreationInputTokens),
            }),
        ...(usage.outputTokens === undefined
            ? {}
            : { outputTokens: Number(usage.outputTokens) }),
        ...(usage.reasoningOutputTokens === undefined
            ? {}
            : {
                reasoningOutputTokens: Number(usage.reasoningOutputTokens),
            }),
        ...(usage.costUsd === undefined
            ? {}
            : { costUsd: Number(usage.costUsd) }),
    };
    const stale = report.status === "running" &&
        Number.isFinite(updatedAt) &&
        now - updatedAt > staleAfterMs;
    return {
        runId: report.runId,
        state: stale ? "stale" : "valid",
        status: report.status,
        updatedAt: report.execution.updatedAt,
        graphFingerprint: report.graph.fingerprint,
        integrityVerified: report.graph.integrityVerified,
        auditSequenceVerified: report.evidence.auditSequenceVerified,
        repairRounds: report.execution.repairRounds,
        budgets: safeBudgets,
        usage: safeUsage,
        verifier: {
            accepted: report.verifier.accepted ?? null,
            reasonCount: report.verifier.reasonCount,
        },
    };
}
export async function collectLocalDashboardSnapshot(directory, options = {}) {
    const empty = () => ({
        version: "1.0",
        surface: "graphvigil-local-dashboard",
        compatibility: {
            status: "contract-only",
            hosts: ["codex", "claude", "cursor", "copilot", "hermes"],
        },
        truncated: false,
        runs: [],
    });
    let directoryInfo;
    try {
        directoryInfo = await lstat(directory);
    }
    catch (error) {
        if (error.code === "ENOENT")
            return empty();
        throw error;
    }
    if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) {
        throw new Error("dashboard audit directory must be a real directory");
    }
    const root = await realpath(directory);
    const allCheckpointNames = (await readdir(root))
        .filter((name) => name.endsWith(".checkpoint.json"))
        .sort();
    const checkpointNames = allCheckpointNames.slice(0, MAX_RUNS);
    const candidates = await Promise.all(checkpointNames.map((name) => inspectCandidate(root, root, name.slice(0, -".checkpoint.json".length))));
    const identityCounts = new Map();
    for (const candidate of candidates) {
        if (candidate.embeddedRunId) {
            identityCounts.set(candidate.embeddedRunId, (identityCounts.get(candidate.embeddedRunId) ?? 0) + 1);
        }
    }
    const now = options.now ?? Date.now();
    const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    const runs = await Promise.all(candidates.map(async (candidate) => {
        if (candidate.embeddedRunId &&
            (identityCounts.get(candidate.embeddedRunId) ?? 0) > 1) {
            return {
                runId: candidate.filenameRunId,
                state: "invalid",
                error: "duplicate_run_identity",
            };
        }
        if (candidate.error ||
            candidate.embeddedRunId !== candidate.filenameRunId) {
            return {
                runId: displayRunId(candidate.filenameRunId),
                state: "invalid",
                error: candidate.error ?? "invalid_run_artifacts",
            };
        }
        try {
            const report = createPortableRunReportFromArtifacts(candidate.checkpointRaw ?? "", candidate.auditRaw ?? "", candidate.filenameRunId);
            return validSummary(report, now, staleAfterMs);
        }
        catch (error) {
            return {
                runId: displayRunId(candidate.filenameRunId),
                state: "invalid",
                error: errorCode(error),
            };
        }
    }));
    return {
        ...empty(),
        truncated: allCheckpointNames.length > MAX_RUNS,
        runs: runs.sort((left, right) => left.runId.localeCompare(right.runId)),
    };
}
const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>GraphVigil local dashboard</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <main>
    <h1>GraphVigil local dashboard</h1>
    <p id="summary">Loading redacted run reports…</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Run</th><th>State</th><th>Status</th><th>Verifier</th><th>Tokens</th><th>Cost USD</th><th>Integrity</th></tr></thead>
        <tbody id="runs"></tbody>
      </table>
    </div>
    <p class="boundary">Read-only, loopback-only, structural evidence. Prompts, outputs, reasons, paths, and credentials are never displayed.</p>
  </main>
  <script src="/app.js" defer></script>
</body>
</html>`;
const css = `:root{color-scheme:dark;font-family:ui-sans-serif,system-ui,sans-serif;background:#0b1020;color:#e8eefc}body{margin:0}main{max-width:1100px;margin:0 auto;padding:3rem 1.25rem}h1{font-size:clamp(2rem,6vw,4.5rem);letter-spacing:-.05em;margin:.2em 0}p{color:#aab6d4}.table-wrap{overflow:auto;border:1px solid #26324e;border-radius:14px;background:#11182b}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:.85rem;border-bottom:1px solid #26324e;white-space:nowrap}th{color:#8da2d5;font-size:.75rem;text-transform:uppercase;letter-spacing:.08em}.ok{color:#79e6a8}.warn{color:#ffd479}.bad{color:#ff8f9d}.boundary{font-size:.85rem;margin-top:1.2rem}`;
const javascript = `const body=document.querySelector("#runs");const summary=document.querySelector("#summary");const cell=(row,value,className)=>{const td=document.createElement("td");td.textContent=String(value);if(className)td.className=className;row.append(td)};fetch("/v1/dashboard",{cache:"no-store"}).then(response=>{if(!response.ok)throw new Error("unavailable");return response.json()}).then(data=>{summary.textContent=data.runs.length+" bounded run record"+(data.runs.length===1?"":"s");for(const run of data.runs){const row=document.createElement("tr");cell(row,run.runId);cell(row,run.state,run.state==="valid"?"ok":run.state==="stale"?"warn":"bad");if(run.state==="invalid"){cell(row,"invalid");cell(row,"—");cell(row,"—");cell(row,"—");cell(row,run.error,"bad")}else{cell(row,run.status);cell(row,run.verifier.accepted===null?"not recorded":run.verifier.accepted?"accepted":"rejected");cell(row,(run.usage.inputTokens??0)+(run.usage.outputTokens??0));cell(row,run.usage.costUsd??"not recorded");cell(row,run.integrityVerified&&run.auditSequenceVerified?"verified":"check",""+(run.integrityVerified&&run.auditSequenceVerified?"ok":"warn"))}body.append(row)}}).catch(()=>{summary.textContent="Dashboard data is unavailable.";summary.className="bad"})`;
function responseHeaders(contentType) {
    return {
        "content-type": contentType,
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
    };
}
function respond(response, status, contentType, value) {
    if (Buffer.byteLength(value, "utf8") > MAX_RESPONSE_BYTES) {
        response.writeHead(500, responseHeaders("application/json; charset=utf-8"));
        response.end('{"error":"bounded response exceeded"}');
        return;
    }
    response.writeHead(status, responseHeaders(contentType));
    response.end(value);
}
export function startLocalDashboard(options = {}) {
    const host = options.host ?? "127.0.0.1";
    const port = options.port ?? 4319;
    const directory = options.directory ??
        process.env.GRAPH_ENGINEER_AUDIT_DIRECTORY ??
        ".graph-runs";
    if (!isLoopback(host)) {
        throw new Error("local dashboard may bind only to a loopback host");
    }
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
        throw new Error("dashboard port must be an integer from 0 to 65535");
    }
    const server = createServer(async (request, response) => {
        try {
            if (request.method !== "GET") {
                respond(response, 405, "application/json; charset=utf-8", '{"error":"method not allowed"}');
                return;
            }
            const path = new URL(request.url ?? "/", "http://localhost").pathname;
            if (path === "/") {
                respond(response, 200, "text/html; charset=utf-8", html);
                return;
            }
            if (path === "/style.css") {
                respond(response, 200, "text/css; charset=utf-8", css);
                return;
            }
            if (path === "/app.js") {
                respond(response, 200, "text/javascript; charset=utf-8", javascript);
                return;
            }
            if (path === "/healthz") {
                respond(response, 200, "application/json; charset=utf-8", '{"status":"ok","version":"1.0","mode":"read-only"}');
                return;
            }
            if (path === "/v1/dashboard") {
                const snapshot = await collectLocalDashboardSnapshot(directory, {
                    ...(options.now === undefined ? {} : { now: options.now }),
                });
                respond(response, 200, "application/json; charset=utf-8", JSON.stringify(snapshot));
                return;
            }
            respond(response, 404, "application/json; charset=utf-8", '{"error":"not found"}');
        }
        catch {
            respond(response, 500, "application/json; charset=utf-8", '{"error":"dashboard data unavailable"}');
        }
    });
    server.listen(port, host);
    return server;
}
//# sourceMappingURL=dashboard.js.map