import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export const requiredReleaseWorkflows = [
  "CI",
  "CodeQL",
  "Publish npm",
  "Release",
];

export const requiredReleaseContexts = [
  "analyze",
  "launch-readiness",
  "package",
  "test (ubuntu-latest, 20)",
  "test (ubuntu-latest, 22)",
  "test (windows-latest, 20)",
  "test (windows-latest, 22)",
];

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function assertString(value, label, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${label} is invalid`);
  }
}

function assertBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be boolean`);
  }
}

function assertOptionalSha(value, label) {
  if (value !== null) {
    assertString(value, label, SHA_PATTERN);
  }
}

export function assertReleaseGateRequest(request) {
  if (!request || typeof request !== "object") {
    throw new Error("release gate request must be an object");
  }
  assertString(request.repository, "repository", REPOSITORY_PATTERN);
  assertString(request.version, "version", VERSION_PATTERN);
  assertString(request.candidateCommit, "candidate commit", SHA_PATTERN);
  if (
    typeof request.candidateBranch !== "string" ||
    request.candidateBranch.length < 1 ||
    request.candidateBranch.length > 200 ||
    request.candidateBranch.includes("..") ||
    request.candidateBranch.startsWith("/") ||
    request.candidateBranch.endsWith("/")
  ) {
    throw new Error("candidate branch is invalid");
  }
}

export function normalizeGithubReleaseSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("GitHub release snapshot must be an object");
  }
  assertString(
    snapshot.repository?.nameWithOwner,
    "snapshot repository",
    REPOSITORY_PATTERN,
  );
  if (
    typeof snapshot.repository?.defaultBranch !== "string" ||
    snapshot.repository.defaultBranch.length < 1
  ) {
    throw new Error("snapshot default branch is invalid");
  }
  assertBoolean(snapshot.repository?.archived, "snapshot archived");

  const protection = snapshot.branchProtection;
  for (const [key, value] of Object.entries({
    strict: protection?.strict,
    linearHistory: protection?.linearHistory,
    conversationResolution: protection?.conversationResolution,
    forcePushesAllowed: protection?.forcePushesAllowed,
  })) {
    assertBoolean(value, `branch protection ${key}`);
  }
  if (!Array.isArray(protection?.requiredContexts)) {
    throw new Error("branch protection contexts must be an array");
  }

  if (!Array.isArray(snapshot.workflows)) {
    throw new Error("workflows must be an array");
  }
  const workflows = snapshot.workflows.map((workflow) => {
    if (
      typeof workflow?.name !== "string" ||
      !["active", "disabled"].includes(workflow?.state)
    ) {
      throw new Error("workflow entry is invalid");
    }
    return { name: workflow.name, state: workflow.state };
  });
  if (new Set(workflows.map(({ name }) => name)).size !== workflows.length) {
    throw new Error("workflow names must be unique");
  }

  const environment = snapshot.npmEnvironment;
  for (const [key, value] of Object.entries({
    exists: environment?.exists,
    protectedBranchesOnly: environment?.protectedBranchesOnly,
  })) {
    assertBoolean(value, `npm environment ${key}`);
  }
  if (
    !Number.isInteger(environment?.requiredReviewerCount) ||
    environment.requiredReviewerCount < 0
  ) {
    throw new Error("npm environment reviewer count is invalid");
  }

  for (const [key, value] of Object.entries({
    candidateBranchCommit: snapshot.refs?.candidateBranchCommit,
    defaultBranchCommit: snapshot.refs?.defaultBranchCommit,
    releaseTagCommit: snapshot.refs?.releaseTagCommit,
  })) {
    assertOptionalSha(value, `snapshot ${key}`);
  }
  if (snapshot.refs.defaultBranchCommit === null) {
    throw new Error("snapshot default branch commit is required");
  }

  if (!Array.isArray(snapshot.checkRuns)) {
    throw new Error("check runs must be an array");
  }
  const checkRuns = snapshot.checkRuns.map((check) => {
    if (
      typeof check?.name !== "string" ||
      ![
        "queued",
        "in_progress",
        "completed",
        "waiting",
        "requested",
        "pending",
      ].includes(check?.status) ||
      ![
        null,
        "success",
        "failure",
        "cancelled",
        "timed_out",
        "action_required",
        "neutral",
        "skipped",
        "stale",
        "startup_failure",
      ].includes(check?.conclusion)
    ) {
      throw new Error("check run entry is invalid");
    }
    assertString(check.headSha, "check run head SHA", SHA_PATTERN);
    return {
      name: check.name,
      headSha: check.headSha,
      status: check.status,
      conclusion: check.conclusion,
    };
  });
  if (new Set(checkRuns.map(({ name }) => name)).size !== checkRuns.length) {
    throw new Error("check run names must be unique");
  }

  return {
    repository: {
      nameWithOwner: snapshot.repository.nameWithOwner,
      defaultBranch: snapshot.repository.defaultBranch,
      archived: snapshot.repository.archived,
    },
    branchProtection: {
      strict: protection.strict,
      requiredContexts: sortedUnique(protection.requiredContexts),
      linearHistory: protection.linearHistory,
      conversationResolution: protection.conversationResolution,
      forcePushesAllowed: protection.forcePushesAllowed,
    },
    workflows: [...workflows].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    npmEnvironment: {
      exists: environment.exists,
      protectedBranchesOnly: environment.protectedBranchesOnly,
      requiredReviewerCount: environment.requiredReviewerCount,
    },
    refs: {
      candidateBranchCommit: snapshot.refs.candidateBranchCommit,
      defaultBranchCommit: snapshot.refs.defaultBranchCommit,
      releaseTagCommit: snapshot.refs.releaseTagCommit,
    },
    checkRuns: [...checkRuns].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
  };
}

function gate(id, category, status, summary, details = {}) {
  return {
    id,
    category,
    status,
    summary,
    ...details,
  };
}

export function evaluateGithubReleaseGate(snapshotInput, request) {
  assertReleaseGateRequest(request);
  const snapshot = normalizeGithubReleaseSnapshot(snapshotInput);
  if (snapshot.repository.nameWithOwner !== request.repository) {
    throw new Error("snapshot repository does not match the request");
  }

  const gates = [];
  gates.push(
    gate(
      "repository-active",
      "configuration",
      snapshot.repository.archived ? "fail" : "pass",
      snapshot.repository.archived
        ? "repository is archived"
        : "repository is active",
    ),
  );

  const activeWorkflows = snapshot.workflows
    .filter(({ state }) => state === "active")
    .map(({ name }) => name);
  const missingWorkflows = requiredReleaseWorkflows.filter(
    (name) => !activeWorkflows.includes(name),
  );
  gates.push(
    gate(
      "required-workflows-active",
      "configuration",
      missingWorkflows.length === 0 ? "pass" : "fail",
      missingWorkflows.length === 0
        ? "all required workflows are active"
        : "required workflows are missing or disabled",
      missingWorkflows.length === 0 ? {} : { missing: missingWorkflows },
    ),
  );

  gates.push(
    gate(
      "strict-status-checks",
      "configuration",
      snapshot.branchProtection.strict ? "pass" : "fail",
      snapshot.branchProtection.strict
        ? "required status checks are strict"
        : "required status checks are not strict",
    ),
  );

  const missingContexts = requiredReleaseContexts.filter(
    (name) => !snapshot.branchProtection.requiredContexts.includes(name),
  );
  gates.push(
    gate(
      "required-status-contexts",
      "configuration",
      missingContexts.length === 0 ? "pass" : "fail",
      missingContexts.length === 0
        ? "all release status contexts are required"
        : "required release status contexts are missing",
      missingContexts.length === 0 ? {} : { missing: missingContexts },
    ),
  );

  gates.push(
    gate(
      "linear-history",
      "configuration",
      snapshot.branchProtection.linearHistory ? "pass" : "fail",
      snapshot.branchProtection.linearHistory
        ? "linear history is required"
        : "linear history is not required",
    ),
  );
  gates.push(
    gate(
      "conversation-resolution",
      "configuration",
      snapshot.branchProtection.conversationResolution ? "pass" : "fail",
      snapshot.branchProtection.conversationResolution
        ? "review conversations must be resolved"
        : "review conversation resolution is not required",
    ),
  );
  gates.push(
    gate(
      "force-push-disabled",
      "configuration",
      snapshot.branchProtection.forcePushesAllowed ? "fail" : "pass",
      snapshot.branchProtection.forcePushesAllowed
        ? "force pushes are allowed"
        : "force pushes are disabled",
    ),
  );

  const npmEnvironmentReady =
    snapshot.npmEnvironment.exists &&
    snapshot.npmEnvironment.protectedBranchesOnly &&
    snapshot.npmEnvironment.requiredReviewerCount > 0;
  gates.push(
    gate(
      "npm-environment-protected",
      "configuration",
      npmEnvironmentReady ? "pass" : "fail",
      npmEnvironmentReady
        ? "npm environment is protected and reviewed"
        : "npm environment protection is incomplete",
    ),
  );

  const candidateRef = snapshot.refs.candidateBranchCommit;
  const candidateRefStatus =
    candidateRef === null
      ? "pending"
      : candidateRef === request.candidateCommit
        ? "pass"
        : "fail";
  gates.push(
    gate(
      "candidate-branch-ref",
      "candidate",
      candidateRefStatus,
      candidateRef === null
        ? "candidate branch has not been pushed"
        : candidateRef === request.candidateCommit
          ? "candidate branch matches the requested commit"
          : "candidate branch points to a different commit",
    ),
  );

  const candidateChecks = new Map(
    snapshot.checkRuns
      .filter(({ headSha }) => headSha === request.candidateCommit)
      .map((check) => [check.name, check]),
  );
  const missingChecks = requiredReleaseContexts.filter(
    (name) => !candidateChecks.has(name),
  );
  const pendingChecks = requiredReleaseContexts.filter((name) => {
    const check = candidateChecks.get(name);
    return check && check.status !== "completed";
  });
  const failedChecks = requiredReleaseContexts.filter((name) => {
    const check = candidateChecks.get(name);
    return (
      check &&
      check.status === "completed" &&
      check.conclusion !== "success"
    );
  });
  const checksComplete =
    missingChecks.length === 0 &&
    pendingChecks.length === 0 &&
    failedChecks.length === 0;
  const checksStatus =
    candidateRef === null || missingChecks.length > 0 || pendingChecks.length > 0
      ? "pending"
      : failedChecks.length > 0
        ? "fail"
        : "pass";
  gates.push(
    gate(
      "candidate-required-checks",
      "candidate",
      checksStatus,
      checksComplete
        ? "all candidate checks passed"
        : failedChecks.length > 0
          ? "candidate checks failed"
          : "candidate checks are incomplete",
      {
        ...(missingChecks.length > 0 ? { missing: missingChecks } : {}),
        ...(pendingChecks.length > 0 ? { pending: pendingChecks } : {}),
        ...(failedChecks.length > 0 ? { failed: failedChecks } : {}),
      },
    ),
  );

  const merged =
    snapshot.refs.defaultBranchCommit === request.candidateCommit;
  gates.push(
    gate(
      "default-branch-ref",
      "candidate",
      merged ? "pass" : "pending",
      merged
        ? "default branch contains the exact candidate commit"
        : "candidate has not been merged to the default branch",
    ),
  );

  const releaseTag = `v${request.version}`;
  const tagCommit = snapshot.refs.releaseTagCommit;
  const tagStatus =
    tagCommit === null
      ? "pass"
      : tagCommit !== request.candidateCommit || !merged
        ? "fail"
        : "pass";
  gates.push(
    gate(
      "release-tag-ref",
      "candidate",
      tagStatus,
      tagCommit === null
        ? `${releaseTag} is available`
        : tagCommit !== request.candidateCommit
          ? `${releaseTag} points to a different commit`
          : !merged
            ? `${releaseTag} exists before the candidate reached the default branch`
            : `${releaseTag} points to the exact merged candidate`,
    ),
  );

  const configurationBlocked = gates.some(
    ({ category, status }) =>
      category === "configuration" && status === "fail",
  );
  const referenceBlocked =
    candidateRefStatus === "fail" || tagStatus === "fail";
  let phase;
  if (configurationBlocked) {
    phase = "configuration_blocked";
  } else if (referenceBlocked) {
    phase = "reference_blocked";
  } else if (candidateRef === null) {
    phase = "ready_to_push";
  } else if (failedChecks.length > 0) {
    phase = "checks_failed";
  } else if (!checksComplete) {
    phase = "awaiting_checks";
  } else if (!merged) {
    phase = "review_ready";
  } else if (tagCommit === null) {
    phase = "tag_ready";
  } else {
    phase = "tagged";
  }

  const blockedPhases = new Set([
    "configuration_blocked",
    "reference_blocked",
    "checks_failed",
  ]);
  return {
    version: "1.0",
    report: "github-release-gate",
    repository: request.repository,
    candidate: {
      version: request.version,
      branch: request.candidateBranch,
      commit: request.candidateCommit,
      tag: releaseTag,
    },
    permissions: {
      githubAccess: "read_only",
      methods: ["GET"],
      mutationEndpoints: [],
    },
    phase,
    passed: !blockedPhases.has(phase),
    decision: {
      readyToPush:
        !configurationBlocked &&
        !referenceBlocked &&
        (candidateRef === null || candidateRef === request.candidateCommit),
      readyToMerge: phase === "review_ready",
      readyToTag: phase === "tag_ready",
    },
    gates,
  };
}

async function defaultGhApiGet(endpoint) {
  try {
    const { stdout } = await execute(
      "gh",
      ["api", "--method", "GET", endpoint],
      {
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      },
    );
    return JSON.parse(stdout);
  } catch (error) {
    const stderr = String(error?.stderr ?? "");
    if (stderr.includes("HTTP 404")) {
      return null;
    }
    throw new Error(`GitHub read failed for ${endpoint}`);
  }
}

function refSha(value) {
  return value?.object?.type === "commit" && SHA_PATTERN.test(value.object.sha)
    ? value.object.sha
    : null;
}

async function tagCommitSha(value, base, ghApiGet) {
  const direct = refSha(value);
  if (direct !== null || value === null) {
    return direct;
  }
  if (
    value?.object?.type !== "tag" ||
    !SHA_PATTERN.test(value.object.sha ?? "")
  ) {
    throw new Error("GitHub release tag reference is invalid");
  }
  const annotated = await ghApiGet(`${base}/git/tags/${value.object.sha}`);
  const commit = refSha(annotated);
  if (commit === null) {
    throw new Error("GitHub annotated release tag does not resolve to a commit");
  }
  return commit;
}

export async function collectGithubReleaseSnapshot(
  request,
  { ghApiGet = defaultGhApiGet } = {},
) {
  assertReleaseGateRequest(request);
  const base = `repos/${request.repository}`;
  const repository = await ghApiGet(base);
  if (!repository) {
    throw new Error("GitHub repository was not found");
  }
  const defaultBranch = encodeURIComponent(repository.default_branch);
  const encodedCandidate = encodeURIComponent(request.candidateBranch);
  const encodedTag = encodeURIComponent(`v${request.version}`);
  const [protection, workflows, environment, candidateRef, defaultRef, tagRef] =
    await Promise.all([
      ghApiGet(`${base}/branches/${defaultBranch}/protection`),
      ghApiGet(`${base}/actions/workflows?per_page=100`),
      ghApiGet(`${base}/environments/npm`),
      ghApiGet(`${base}/git/ref/heads/${encodedCandidate}`),
      ghApiGet(`${base}/git/ref/heads/${defaultBranch}`),
      ghApiGet(`${base}/git/ref/tags/${encodedTag}`),
    ]);
  const candidateBranchCommit = refSha(candidateRef);
  const releaseTagCommit = await tagCommitSha(tagRef, base, ghApiGet);
  const checks =
    candidateBranchCommit === null
      ? { check_runs: [] }
      : await ghApiGet(
          `${base}/commits/${request.candidateCommit}/check-runs?per_page=100`,
        );

  const seenChecks = new Set();
  const checkRuns = [];
  for (const check of checks?.check_runs ?? []) {
    if (
      typeof check?.name !== "string" ||
      seenChecks.has(check.name) ||
      !SHA_PATTERN.test(check.head_sha ?? "")
    ) {
      continue;
    }
    seenChecks.add(check.name);
    checkRuns.push({
      name: check.name,
      headSha: check.head_sha,
      status: check.status,
      conclusion: check.conclusion,
    });
  }

  const requiredReviewers =
    environment?.protection_rules?.find(
      (rule) => rule.type === "required_reviewers",
    )?.reviewers ?? [];
  return normalizeGithubReleaseSnapshot({
    repository: {
      nameWithOwner: repository.full_name,
      defaultBranch: repository.default_branch,
      archived: repository.archived,
    },
    branchProtection: {
      strict: protection?.required_status_checks?.strict ?? false,
      requiredContexts:
        protection?.required_status_checks?.checks?.map(
          (check) => check.context,
        ) ??
        protection?.required_status_checks?.contexts ??
        [],
      linearHistory: protection?.required_linear_history?.enabled ?? false,
      conversationResolution:
        protection?.required_conversation_resolution?.enabled ?? false,
      forcePushesAllowed: protection?.allow_force_pushes?.enabled ?? false,
    },
    workflows:
      workflows?.workflows?.map((workflow) => ({
        name: workflow.name,
        state: workflow.state === "active" ? "active" : "disabled",
      })) ?? [],
    npmEnvironment: {
      exists: environment !== null,
      protectedBranchesOnly:
        environment?.deployment_branch_policy?.protected_branches ?? false,
      requiredReviewerCount: requiredReviewers.length,
    },
    refs: {
      candidateBranchCommit,
      defaultBranchCommit: refSha(defaultRef),
      releaseTagCommit,
    },
    checkRuns,
  });
}
