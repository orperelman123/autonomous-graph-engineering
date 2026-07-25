import { access } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";

export const expectedHosts = [
  "codex",
  "claude",
  "cursor",
  "copilot",
  "hermes",
];

export function assertCompatibilityMatrix(matrix) {
  if (
    matrix?.version !== "1.0" ||
    matrix?.matrix !== "graphvigil-host-compatibility" ||
    !Array.isArray(matrix.hosts)
  ) {
    throw new Error("host compatibility matrix has an invalid root contract");
  }
  const ids = matrix.hosts.map((host) => host?.id);
  if (
    ids.length !== expectedHosts.length ||
    new Set(ids).size !== expectedHosts.length ||
    expectedHosts.some((host) => !ids.includes(host))
  ) {
    throw new Error(
      `host compatibility matrix must contain each supported host exactly once: ${expectedHosts.join(", ")}`,
    );
  }
  for (const host of matrix.hosts) {
    if (
      host.versionCoverage?.status === "contract-only" &&
      (host.versionCoverage.testedVersions?.length !== 0 ||
        host.versionCoverage.liveEvidence?.length !== 0)
    ) {
      throw new Error(
        `${host.id} cannot claim tested versions or live evidence with contract-only coverage`,
      );
    }
    if (
      host.versionCoverage?.status === "live-tested" &&
      (!host.versionCoverage.testedVersions?.length ||
        !host.versionCoverage.liveEvidence?.length)
    ) {
      throw new Error(
        `${host.id} live-tested coverage requires versions and live evidence`,
      );
    }
    if (!Array.isArray(host.evidence) || host.evidence.length < 2) {
      throw new Error(`${host.id} requires at least two repository evidence paths`);
    }
    for (const path of [
      ...host.evidence,
      ...(host.versionCoverage?.liveEvidence ?? []),
    ]) {
      const segments = String(path).split("/");
      if (
        isAbsolute(path) ||
        /^[A-Za-z]:/.test(path) ||
        path.includes("\\") ||
        segments.includes("..")
      ) {
        throw new Error(
          `${host.id} evidence path must be repository-relative: ${path}`,
        );
      }
    }
  }
}

export async function evaluateCompatibilityMatrix(matrix, root) {
  assertCompatibilityMatrix(matrix);
  const rootPrefix = `${resolve(root)}${sep}`;
  const cases = [];
  for (const host of matrix.hosts) {
    const paths = [
      ...host.evidence,
      ...(host.versionCoverage.liveEvidence ?? []),
    ];
    const evidence = [];
    for (const path of paths) {
      const resolved = resolve(root, ...path.split("/"));
      if (!resolved.startsWith(rootPrefix)) {
        throw new Error(`${host.id} evidence resolved outside the repository`);
      }
      let exists = true;
      try {
        await access(resolved);
      } catch {
        exists = false;
      }
      evidence.push({ path, exists });
    }
    cases.push({
      host: host.id,
      passed: evidence.every((item) => item.exists),
      evidence,
    });
  }
  return cases;
}
