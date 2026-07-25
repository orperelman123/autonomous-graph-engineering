import assert from "node:assert/strict";
import test from "node:test";
import {
  assertEffectivePromptWithinBudget,
  getPromptContextSource,
  markPromptContextSource,
  normalizePromptContext,
  PROMPT_CONTEXT_LIMITS,
  renderPromptContextLines,
} from "../src/context-policy.js";
import { collectContext } from "../src/context.js";
import * as publicApi from "../src/index.js";

test("preserves valid caller context while making its source explicit", () => {
  const context = {
    cwd: "C:\\work\\demo",
    projectName: "demo",
    frameworks: ["typescript", "react"],
    availableTools: ["git"],
    conversationSummary: "Keep the public API compatible.",
    instructions: ["Run focused tests.", "Do not deploy."],
  };
  const normalized = normalizePromptContext(context);
  assert.deepEqual(normalized, {
    context,
    source: "caller",
    lines: [
      "Context source: caller supplied",
      "Project: demo",
      "Working directory: C:\\work\\demo",
      "Detected stack: typescript, react",
      "Available tools: git",
      "Conversation context: Keep the public API compatible.",
      "Run focused tests.",
      "Do not deploy.",
    ],
  });
  assert.notEqual(normalized?.context, context);
});

test("deduplicates exact array entries in first-seen order", () => {
  const normalized = normalizePromptContext({
    frameworks: ["typescript", "typescript", "react", "typescript"],
    instructions: ["same", "same", "different"],
  });
  assert.deepEqual(normalized?.context.frameworks, ["typescript", "react"]);
  assert.deepEqual(normalized?.context.instructions, ["same", "different"]);
});

test("rejects malformed scalar, array, and unknown metadata", () => {
  assert.throws(
    () => normalizePromptContext({ projectName: { name: "demo" } }),
    /context\.projectName must be a string/,
  );
  assert.throws(
    () => normalizePromptContext({ frameworks: ["typescript", 42] }),
    /context\.frameworks must contain only strings/,
  );
  assert.throws(
    () => normalizePromptContext({ instructions: [""] }),
    /context\.instructions must not contain blank strings/,
  );
  assert.throws(
    () => normalizePromptContext({ source: "filesystem" }),
    /context contains unsupported field: source/,
  );
  assert.throws(() => normalizePromptContext([]), /context must be an object/);
});

test("enforces scalar, item-count, item-size, and aggregate byte bounds", () => {
  assert.throws(
    () =>
      normalizePromptContext({
        projectName: "p".repeat(
          PROMPT_CONTEXT_LIMITS.scalarCharacters + 1,
        ),
      }),
    /context\.projectName exceeds/,
  );
  assert.throws(
    () =>
      normalizePromptContext({
        frameworks: Array.from(
          { length: PROMPT_CONTEXT_LIMITS.arrayItems + 1 },
          (_, index) => `framework-${index}`,
        ),
      }),
    /context\.frameworks exceeds/,
  );
  assert.throws(
    () =>
      normalizePromptContext({
        instructions: [
          "i".repeat(PROMPT_CONTEXT_LIMITS.arrayItemCharacters + 1),
        ],
      }),
    /context\.instructions item exceeds/,
  );
  assert.throws(
    () =>
      normalizePromptContext({
        frameworks: Array.from(
          { length: PROMPT_CONTEXT_LIMITS.arrayItems },
          (_, index) =>
            `${index}:`.padEnd(
              PROMPT_CONTEXT_LIMITS.arrayItemCharacters,
              "f",
            ),
        ),
        availableTools: Array.from(
          { length: PROMPT_CONTEXT_LIMITS.arrayItems },
          (_, index) =>
            `${index}:`.padEnd(
              PROMPT_CONTEXT_LIMITS.arrayItemCharacters,
              "t",
            ),
        ),
        instructions: Array.from(
          { length: PROMPT_CONTEXT_LIMITS.arrayItems },
          (_, index) =>
            `${index}:`.padEnd(
              PROMPT_CONTEXT_LIMITS.arrayItemCharacters,
              "i",
            ),
        ),
      }),
    /rendered context exceeds/,
  );
});

test("tracks trusted filesystem attribution out of band", () => {
  const context = markPromptContextSource(
    { projectName: "demo", cwd: "/work/demo" },
    "explicit_cwd",
  );
  assert.equal(getPromptContextSource(context), "explicit_cwd");
  assert.deepEqual(normalizePromptContext(context)?.lines, [
    "Context source: filesystem inspection of an explicit working directory",
    "Project: demo",
    "Working directory: /work/demo",
  ]);
  assert.equal(
    getPromptContextSource({ ...context }),
    "caller",
    "serialized or cloned values must not inherit trusted provenance",
  );
  assert.throws(
    () => {
      context.projectName = "forged";
    },
    TypeError,
  );
  assert.equal(context.projectName, "demo");
  assert.equal(
    "markPromptContextSource" in publicApi,
    false,
    "callers must not be able to forge trusted provenance",
  );
});

test("renders process cwd attribution distinctly", () => {
  assert.deepEqual(
    renderPromptContextLines(
      { projectName: "demo" },
      "process_cwd",
    ),
    [
      "Context source: filesystem inspection of the process working directory",
      "Project: demo",
    ],
  );
});

test("collectContext distinguishes explicit and process working directories", async () => {
  const explicit = await collectContext(process.cwd());
  const ambient = await collectContext();
  assert.equal(getPromptContextSource(explicit), "explicit_cwd");
  assert.equal(getPromptContextSource(ambient), "process_cwd");
  assert.equal(explicit.cwd, ambient.cwd);
  assert.equal(Object.isFrozen(explicit), true);
  assert.equal(Object.isFrozen(explicit.frameworks), true);
});

test("enforces the effective-prompt budget in UTF-8 bytes", () => {
  assert.doesNotThrow(() =>
    assertEffectivePromptWithinBudget(
      "a".repeat(PROMPT_CONTEXT_LIMITS.effectivePromptBytes),
    ),
  );
  assert.throws(
    () =>
      assertEffectivePromptWithinBudget(
        "😀".repeat(
          Math.floor(PROMPT_CONTEXT_LIMITS.effectivePromptBytes / 4) + 1,
        ),
      ),
    /effective prompt exceeds/,
  );
});
