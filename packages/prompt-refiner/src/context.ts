import { basename, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import type { PromptContext } from "./types.js";

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export async function collectContext(cwd = process.cwd()): Promise<PromptContext> {
  const absolute = resolve(cwd);
  const packageJson = await readJson(resolve(absolute, "package.json"));
  const dependencies = {
    ...((packageJson?.dependencies as Record<string, unknown> | undefined) ?? {}),
    ...((packageJson?.devDependencies as Record<string, unknown> | undefined) ?? {}),
  };
  const frameworkCandidates = [
    "react",
    "next",
    "vite",
    "typescript",
    "express",
    "hono",
    "fastify",
    "vue",
    "svelte",
  ];
  const frameworks = frameworkCandidates.filter((name) => name in dependencies);
  return {
    cwd: absolute,
    projectName:
      typeof packageJson?.name === "string"
        ? packageJson.name
        : basename(absolute),
    frameworks,
  };
}
