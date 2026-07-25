import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import {
  collectGithubReleaseSnapshot,
  evaluateGithubReleaseGate,
  requiredReleaseContexts,
  requiredReleaseWorkflows,
} from "../scripts/github-release-gate-lib.mjs";

const execute = promisify(execFile);
const candidateCommit = "a".repeat(40);
const baseCommit = "b".repeat(40);
const request = {
  repository: "example/graphvigil",
  version: "0.4.0",
  candidateBranch: "codex/release-v0.4.0",
  candidateCommit,
};

function snapshot({
  contexts = requiredReleaseContexts,
  workflows = requiredReleaseWorkflows.map((name) => ({
    name,
    state: "active",
  })),
  npmEnvironment = {
    exists: true,
    protectedBranchesOnly: true,
    requiredReviewerCount: 1,
  },
  candidateBranchCommit = null as string | null,
  defaultBranchCommit = baseCommit,
  releaseTagCommit = null as string | null,
  checkRuns = [] as Array<{
    name: string;
    headSha: string;
    status: string;
    conclusion: string | null;
  }>,
} = {}) {
  return {
    repository: {
      nameWithOwner: request.repository,
      defaultBranch: "main",
      archived: false,
    },
    branchProtection: {
      strict: true,
      requiredContexts: contexts,
      linearHistory: true,
      conversationResolution: true,
      forcePushesAllowed: false,
    },
    workflows,
    npmEnvironment,
    refs: {
      candidateBranchCommit,
      defaultBranchCommit,
      releaseTagCommit,
    },
    checkRuns,
  };
}

function successfulChecks() {
  return requiredReleaseContexts.map((name) => ({
    name,
    headSha: candidateCommit,
    status: "completed",
    conclusion: "success",
  }));
}

test("detects a missing required launch-readiness context", () => {
  const report = evaluateGithubReleaseGate(
    snapshot({
      contexts: requiredReleaseContexts.filter(
        (name) => name !== "launch-readiness",
      ),
    }),
    request,
  );
  assert.equal(report.phase, "configuration_blocked");
  assert.equal(report.passed, false);
  assert.equal(report.decision.readyToPush, false);
  assert.deepEqual(
    report.gates.find(({ id }) => id === "required-status-contexts")?.missing,
    ["launch-readiness"],
  );

  const workflowDrift = evaluateGithubReleaseGate(
    snapshot({
      workflows: requiredReleaseWorkflows
        .filter((name) => name !== "Release")
        .map((name) => ({ name, state: "active" })),
    }),
    request,
  );
  assert.equal(workflowDrift.phase, "configuration_blocked");
  assert.deepEqual(
    workflowDrift.gates.find(
      ({ id }) => id === "required-workflows-active",
    )?.missing,
    ["Release"],
  );

  const environmentDrift = evaluateGithubReleaseGate(
    snapshot({
      npmEnvironment: {
        exists: true,
        protectedBranchesOnly: true,
        requiredReviewerCount: 0,
      },
    }),
    request,
  );
  assert.equal(environmentDrift.phase, "configuration_blocked");
  assert.equal(
    environmentDrift.gates.find(
      ({ id }) => id === "npm-environment-protected",
    )?.status,
    "fail",
  );
});

test("reports a fully configured absent candidate as ready to push", () => {
  const report = evaluateGithubReleaseGate(snapshot(), request);
  assert.equal(report.phase, "ready_to_push");
  assert.equal(report.passed, true);
  assert.deepEqual(report.decision, {
    readyToPush: true,
    readyToMerge: false,
    readyToTag: false,
  });
  assert.equal(
    report.gates.find(({ id }) => id === "candidate-branch-ref")?.status,
    "pending",
  );
});

test("uses exact post-push checks to distinguish review and tag readiness", () => {
  const awaiting = evaluateGithubReleaseGate(
    snapshot({ candidateBranchCommit: candidateCommit }),
    request,
  );
  assert.equal(awaiting.phase, "awaiting_checks");
  assert.equal(awaiting.decision.readyToMerge, false);

  const review = evaluateGithubReleaseGate(
    snapshot({
      candidateBranchCommit: candidateCommit,
      checkRuns: successfulChecks(),
    }),
    request,
  );
  assert.equal(review.phase, "review_ready");
  assert.equal(review.decision.readyToMerge, true);

  const tag = evaluateGithubReleaseGate(
    snapshot({
      candidateBranchCommit: candidateCommit,
      defaultBranchCommit: candidateCommit,
      checkRuns: successfulChecks(),
    }),
    request,
  );
  assert.equal(tag.phase, "tag_ready");
  assert.equal(tag.decision.readyToTag, true);
});

test("fails closed for candidate ref, tag, and check drift", () => {
  const refDrift = evaluateGithubReleaseGate(
    snapshot({ candidateBranchCommit: baseCommit }),
    request,
  );
  assert.equal(refDrift.phase, "reference_blocked");
  assert.equal(refDrift.passed, false);

  const failedChecks = successfulChecks();
  failedChecks[0] = { ...failedChecks[0], conclusion: "failure" };
  const checkDrift = evaluateGithubReleaseGate(
    snapshot({
      candidateBranchCommit: candidateCommit,
      checkRuns: failedChecks,
    }),
    request,
  );
  assert.equal(checkDrift.phase, "checks_failed");
  assert.equal(checkDrift.passed, false);

  const tagDrift = evaluateGithubReleaseGate(
    snapshot({
      candidateBranchCommit: candidateCommit,
      defaultBranchCommit: candidateCommit,
      releaseTagCommit: baseCommit,
      checkRuns: successfulChecks(),
    }),
    request,
  );
  assert.equal(tagDrift.phase, "reference_blocked");

  const prematureTag = evaluateGithubReleaseGate(
    snapshot({
      candidateBranchCommit: candidateCommit,
      releaseTagCommit: candidateCommit,
      checkRuns: successfulChecks(),
    }),
    request,
  );
  assert.equal(prematureTag.phase, "reference_blocked");
});

test("offline CLI output is deterministic, strict, and path-free", async () => {
  const directory = await mkdtemp(join(tmpdir(), "release-gate-"));
  const snapshotPath = join(directory, "snapshot.json");
  await writeFile(snapshotPath, JSON.stringify(snapshot()));
  const args = [
    "scripts/github-release-gate.mjs",
    "--snapshot",
    snapshotPath,
    "--repo",
    request.repository,
    "--candidate-branch",
    request.candidateBranch,
    "--candidate-commit",
    request.candidateCommit,
    "--version",
    request.version,
  ];
  const first = await execute(process.execPath, args);
  const second = await execute(process.execPath, args);
  assert.equal(first.stdout, second.stdout);
  const report = JSON.parse(first.stdout);

  const schema = JSON.parse(
    await readFile(
      new URL(
        "../schemas/github-release-gate-report.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  assert.equal(
    validate(report),
    true,
    JSON.stringify(validate.errors, null, 2),
  );
  assert.doesNotMatch(first.stdout, /(?:[A-Za-z]:\\|\/home\/|\/Users\/)/);
  assert.deepEqual(report.permissions, {
    githubAccess: "read_only",
    methods: ["GET"],
    mutationEndpoints: [],
  });
});

test("live collector uses only the injected read-only GET interface", async () => {
  const endpoints: string[] = [];
  const responses = new Map<string, unknown>([
    [
      "repos/example/graphvigil",
      {
        full_name: request.repository,
        default_branch: "main",
        archived: false,
      },
    ],
    [
      "repos/example/graphvigil/branches/main/protection",
      {
        required_status_checks: {
          strict: true,
          checks: requiredReleaseContexts.map((context) => ({ context })),
        },
        required_linear_history: { enabled: true },
        required_conversation_resolution: { enabled: true },
        allow_force_pushes: { enabled: false },
      },
    ],
    [
      "repos/example/graphvigil/actions/workflows?per_page=100",
      {
        workflows: requiredReleaseWorkflows.map((name) => ({
          name,
          state: "active",
        })),
      },
    ],
    [
      "repos/example/graphvigil/environments/npm",
      {
        deployment_branch_policy: { protected_branches: true },
        protection_rules: [
          { type: "required_reviewers", reviewers: [{ type: "User" }] },
        ],
      },
    ],
    [
      "repos/example/graphvigil/git/ref/heads/codex%2Frelease-v0.4.0",
      { object: { type: "commit", sha: candidateCommit } },
    ],
    [
      "repos/example/graphvigil/git/ref/heads/main",
      { object: { type: "commit", sha: baseCommit } },
    ],
    ["repos/example/graphvigil/git/ref/tags/v0.4.0", null],
    [
      `repos/example/graphvigil/commits/${candidateCommit}/check-runs?per_page=100`,
      {
        check_runs: successfulChecks().map((check) => ({
          ...check,
          head_sha: check.headSha,
        })),
      },
    ],
  ]);
  const collected = await collectGithubReleaseSnapshot(request, {
    ghApiGet: async (endpoint: string) => {
      endpoints.push(endpoint);
      if (!responses.has(endpoint)) {
        throw new Error(`unexpected endpoint: ${endpoint}`);
      }
      return responses.get(endpoint);
    },
  });
  assert.equal(collected.refs.candidateBranchCommit, candidateCommit);
  assert.equal(collected.checkRuns.length, requiredReleaseContexts.length);
  assert.ok(endpoints.every((endpoint) => endpoint.startsWith("repos/")));
  assert.equal(evaluateGithubReleaseGate(collected, request).phase, "review_ready");

  const tagObjectSha = "c".repeat(40);
  responses.set("repos/example/graphvigil/git/ref/heads/main", {
    object: { type: "commit", sha: candidateCommit },
  });
  responses.set("repos/example/graphvigil/git/ref/tags/v0.4.0", {
    object: { type: "tag", sha: tagObjectSha },
  });
  responses.set(`repos/example/graphvigil/git/tags/${tagObjectSha}`, {
    object: { type: "commit", sha: candidateCommit },
  });
  const annotated = await collectGithubReleaseSnapshot(request, {
    ghApiGet: async (endpoint: string) => {
      endpoints.push(endpoint);
      if (!responses.has(endpoint)) {
        throw new Error(`unexpected endpoint: ${endpoint}`);
      }
      return responses.get(endpoint);
    },
  });
  assert.equal(annotated.refs.releaseTagCommit, candidateCommit);
  assert.equal(evaluateGithubReleaseGate(annotated, request).phase, "tagged");
});

test("rejects malformed and duplicate untrusted snapshot fields", () => {
  assert.throws(
    () =>
      evaluateGithubReleaseGate(snapshot(), {
        ...request,
        candidateBranch: "../main",
      }),
    /candidate branch is invalid/,
  );
  const duplicateChecks = successfulChecks();
  duplicateChecks.push({ ...duplicateChecks[0] });
  assert.throws(
    () =>
      evaluateGithubReleaseGate(
        snapshot({
          candidateBranchCommit: candidateCommit,
          checkRuns: duplicateChecks,
        }),
        request,
      ),
    /check run names must be unique/,
  );
});
