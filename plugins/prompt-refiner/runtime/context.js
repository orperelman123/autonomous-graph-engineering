import { basename, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { markPromptContextSource } from "./context-policy.js";
async function readJson(path) {
    try {
        return JSON.parse(await readFile(path, "utf8"));
    }
    catch {
        return undefined;
    }
}
export async function collectContext(cwd) {
    const source = cwd === undefined ? "process_cwd" : "explicit_cwd";
    const absolute = resolve(cwd ?? process.cwd());
    const packageJson = await readJson(resolve(absolute, "package.json"));
    const dependencies = {
        ...(packageJson?.dependencies ?? {}),
        ...(packageJson?.devDependencies ?? {}),
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
    return markPromptContextSource({
        cwd: absolute,
        projectName: typeof packageJson?.name === "string"
            ? packageJson.name
            : basename(absolute),
        frameworks,
    }, source);
}
//# sourceMappingURL=context.js.map