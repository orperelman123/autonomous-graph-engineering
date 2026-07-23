import { access, readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const ignored = new Set([".git", "node_modules", "dist", ".graph-runs"]);

async function markdownFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await markdownFiles(path));
    else if (extname(entry.name) === ".md") result.push(path);
  }
  return result;
}

const failures = [];
for (const path of await markdownFiles(root)) {
  const content = await readFile(path, "utf8");
  const links = [...content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map(
    (match) => match[1],
  );
  for (const link of links) {
    if (
      !link ||
      link.startsWith("#") ||
      /^(?:https?:|mailto:)/i.test(link)
    ) {
      continue;
    }
    const target = decodeURIComponent(link.split("#")[0]);
    const absolute = resolve(dirname(path), target);
    if (!absolute.startsWith(root)) {
      failures.push(`${relative(root, path)}: link escapes repository: ${link}`);
      continue;
    }
    try {
      await access(absolute);
    } catch {
      failures.push(`${relative(root, path)}: missing ${link}`);
    }
  }
}
if (failures.length) {
  process.stderr.write(`Broken local links:\n${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Local Markdown link check passed.\n");
}
