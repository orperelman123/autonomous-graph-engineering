import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import test from "node:test";

const execute = promisify(execFile);

test("release version is synchronized across packages, plugins, and servers", async () => {
  const manifests = await Promise.all(
    [
      "package.json",
      "packages/prompt-refiner/package.json",
      "packages/graph-orchestrator/package.json",
      "plugins/prompt-refiner/package.json",
      "plugins/prompt-refiner/plugin.json",
      "plugins/prompt-refiner/.codex-plugin/plugin.json",
      "plugins/prompt-refiner/.cursor-plugin/plugin.json",
    ].map(async (path) =>
      JSON.parse(await readFile(path, "utf8")) as {
        version: string;
        dependencies?: Record<string, string>;
      },
    ),
  );
  assert.deepEqual(
    manifests.map((manifest) => manifest.version),
    Array(manifests.length).fill("0.3.3"),
  );
  assert.equal(
    manifests[2]?.dependencies?.[
      "@autonomous-graph-engineering/prompt-refiner"
    ],
    "0.3.3",
  );
  for (const path of [
    "packages/prompt-refiner/src/version.ts",
    "packages/graph-orchestrator/src/version.ts",
  ]) {
    assert.match(
      await readFile(path, "utf8"),
      /export const [A-Z_]+_VERSION = "0\.3\.3"/,
    );
  }
  const marketplace = JSON.parse(
    await readFile(".github/plugin/marketplace.json", "utf8"),
  ) as {
    metadata: { version: string };
    plugins: Array<{ version: string }>;
  };
  assert.equal(marketplace.metadata.version, "0.3.3");
  assert.equal(marketplace.plugins[0]?.version, "0.3.3");
});

test("repository excludes credential artifacts and vendored Atbash source", async () => {
  const tracked = (await execute("git", ["ls-files", "-z"], {
    cwd: process.cwd(),
  })).stdout
    .split("\0")
    .filter(Boolean)
    .map((path) => path.replaceAll("\\", "/"));
  const forbidden = tracked.filter(
    (path) =>
      /(^|\/)(?:node_modules|vendor\/atbash|benchmark\/results|\.graph-runs)\//i.test(
        path,
      ) ||
      /\.(?:pem|key|p12|pfx|jks|keystore)$/i.test(path) ||
      (/(^|\/)\.env(?:\.|$)/i.test(path) && !path.endsWith(".example.env")),
  );
  assert.deepEqual(forbidden, []);

  const graphPackage = JSON.parse(
    await readFile("packages/graph-orchestrator/package.json", "utf8"),
  ) as {
    files?: string[];
    optionalDependencies?: Record<string, string>;
  };
  assert.deepEqual(graphPackage.files, ["dist"]);
  assert.equal(graphPackage.optionalDependencies?.["@atbash/sdk"], "0.6.0");
  assert.equal(
    tracked.some(
      (path) =>
        /(?:^|\/)(?:node_modules\/@atbash|vendor\/atbash)(?:\/|$)/i.test(path),
    ),
    false,
  );

  const lock = await readFile("package-lock.json", "utf8");
  assert.match(
    lock,
    /https:\/\/registry\.npmjs\.org\/@atbash\/sdk\/-\/sdk-0\.6\.0\.tgz/,
  );
});

test("npm trusted publishing is manual, least-privilege, and retry-safe", async () => {
  const workflow = await readFile(
    ".github/workflows/npm-publish.yml",
    "utf8",
  );
  assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+(push|pull_request|schedule):/m);
  assert.match(workflow, /^permissions:\s*\{\}/m);
  assert.match(workflow, /group: npm-publish-\$\{\{\s*inputs\.tag\s*\}\}/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /^\s+environment: npm$/m);
  assert.match(workflow, /^\s+id-token: write$/m);
  assert.match(workflow, /^\s+contents: read$/m);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /node-version: 24/);
  assert.match(workflow, /package-manager-cache: false/);
  assert.match(workflow, /verify-release-version\.mjs "\$RELEASE_TAG"/);
  assert.match(workflow, /git merge-base --is-ancestor/);
  assert.match(workflow, /existing_integrity.*local_integrity/);
  assert.match(workflow, /for attempt in 1 2 3 4 5 6/);
  assert.match(workflow, /NPM_CONFIG_PROVENANCE: "true"/);
  assert.doesNotMatch(workflow, /(NODE_AUTH_TOKEN|NPM_TOKEN|secrets\.)/);
  assert.doesNotMatch(workflow, /version="\$\{\{\s*inputs\.tag\s*\}\}"/);
  const promptPublish = workflow.indexOf(
    '"@autonomous-graph-engineering/prompt-refiner"',
  );
  const graphPublish = workflow.indexOf(
    '"@autonomous-graph-engineering/graph-engineer"',
  );
  assert.ok(promptPublish > 0);
  assert.ok(graphPublish > promptPublish);

  const verified = await execute(
    process.execPath,
    ["scripts/verify-release-version.mjs", "v0.3.3"],
    { cwd: process.cwd() },
  );
  assert.equal(
    (JSON.parse(verified.stdout) as { version: string }).version,
    "0.3.3",
  );
  await assert.rejects(
    execute(
      process.execPath,
      ["scripts/verify-release-version.mjs", "not-a-release"],
      { cwd: process.cwd() },
    ),
  );
});

test("doctor returns a machine-readable readiness report", async () => {
  const { stdout } = await execute(
    process.execPath,
    ["scripts/doctor.mjs", "--json"],
    { cwd: process.cwd() },
  );
  const report = JSON.parse(stdout) as {
    status: string;
    checks: Array<{ id: string; required: boolean; passed: boolean }>;
    summary: { failures: number };
  };
  assert.equal(report.status, "ready");
  assert.equal(report.summary.failures, 0);
  assert.ok(report.checks.some((check) => check.id === "node-version"));
  assert.ok(report.checks.some((check) => check.id === "local-plugin"));
});

test("quickstart remains credential-free and discoverable", async () => {
  const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts?: Record<string, string>;
  };
  assert.equal(rootPackage.scripts?.quickstart, "node scripts/quickstart.mjs");
  assert.equal(rootPackage.scripts?.prequickstart, "npm run build");
  assert.doesNotMatch(
    rootPackage.scripts?.quickstart ?? "",
    /(OPENAI|ANTHROPIC|ATBASH|--execute|install:)/,
  );
  assert.match(
    await readFile("docs/getting-started.md", "utf8"),
    /npm run quickstart/,
  );
});

test("offline control-plane benchmark is reproducible", async () => {
  const first = await execute(process.execPath, ["scripts/benchmark.mjs"], {
    cwd: process.cwd(),
  });
  const second = await execute(process.execPath, ["scripts/benchmark.mjs"], {
    cwd: process.cwd(),
  });
  assert.equal(first.stdout, second.stdout);
  const { stdout } = first;
  const report = JSON.parse(stdout) as {
    passed: boolean;
    scenarios: Array<{
      name: string;
      status: string;
      repairRounds: number;
      passed: boolean;
    }>;
  };
  assert.equal(report.passed, true);
  assert.deepEqual(
    report.scenarios.map(({ name, status, repairRounds, passed }) => ({
      name,
      status,
      repairRounds,
      passed,
    })),
    [
      {
        name: "direct-no-repair",
        status: "failed",
        repairRounds: 0,
        passed: true,
      },
      {
        name: "bounded-loop",
        status: "completed",
        repairRounds: 1,
        passed: true,
      },
      {
        name: "validated-graph",
        status: "completed",
        repairRounds: 1,
        passed: true,
      },
    ],
  );
});

test("offline provider-envelope benchmark is reproducible", async () => {
  const first = await execute(process.execPath, ["scripts/provider-benchmark.mjs"], {
    cwd: process.cwd(),
  });
  const second = await execute(process.execPath, ["scripts/provider-benchmark.mjs"], {
    cwd: process.cwd(),
  });
  assert.equal(first.stdout, second.stdout);
  const report = JSON.parse(first.stdout) as {
    passed: boolean;
    cases: Array<{ provider: string; passed: boolean }>;
  };
  assert.equal(report.passed, true);
  assert.deepEqual(
    report.cases.map(({ provider, passed }) => ({ provider, passed })),
    [
      { provider: "codex", passed: true },
      { provider: "claude", passed: true },
    ],
  );
});

test("demo produces a validated graph without provider credentials", async () => {
  const { stdout } = await execute(process.execPath, ["scripts/demo.mjs"], {
    cwd: process.cwd(),
  });
  assert.match(stdout, /scope -> investigate -> reduce -> cross_check/);
  assert.match(stdout, /validation: passed/);
  assert.match(stdout, /permissions: none/);
});
