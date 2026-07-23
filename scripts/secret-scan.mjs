import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const ignored = new Set([".git", "node_modules", "dist", ".graph-runs", "coverage"]);
const textExtensions = new Set([
  ".ts", ".js", ".mjs", ".cjs", ".json", ".md", ".yml", ".yaml",
  ".toml", ".env", ".txt",
]);
const patterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["GitHub token", /\bgh[opsu]_[A-Za-z0-9]{20,}\b/],
  ["OpenAI key", /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["Anthropic key", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["user-specific Windows path", /\b[A-Za-z]:\\Users\\[^\\\s]+\\/i],
];

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (textExtensions.has(extname(entry.name)) || entry.name.startsWith(".")) {
      result.push(path);
    }
  }
  return result;
}

const failures = [];
for (const path of await files(root)) {
  const content = await readFile(path, "utf8");
  for (const [label, pattern] of patterns) {
    if (pattern.test(content)) {
      failures.push(`${relative(root, path)}: ${label}`);
    }
  }
}
if (failures.length) {
  process.stderr.write(`Potential secrets or private paths found:\n${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Secret and private-path scan passed.\n");
}
