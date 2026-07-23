#!/usr/bin/env node
import { runAgent } from "./runner.js";

const prompt = process.argv.slice(2).join(" ");
if (!prompt) {
  process.stderr.write("Usage: codex-better <prompt>\n");
  process.exitCode = 1;
} else {
  void runAgent("codex", prompt, {
    semantic: process.env.PROMPT_REFINER_SEMANTIC === "true",
  }).then((code) => {
    process.exitCode = code;
  });
}
