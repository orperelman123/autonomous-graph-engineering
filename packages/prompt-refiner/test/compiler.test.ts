import assert from "node:assert/strict";
import test from "node:test";
import {
  compilePrompt,
  runEvaluation,
} from "../src/index.js";

test("preserves the original prompt exactly", () => {
  const prompt = "Build the API, but do not deploy it.";
  const result = compilePrompt({ prompt });
  assert.equal(result.originalPrompt, prompt);
  assert.match(result.effectivePrompt, /Build the API, but do not deploy it\./);
});

test("does not infer permissions for a read-only review", () => {
  const result = compilePrompt({
    prompt: "Review the authentication code and report risks.",
  });
  assert.deepEqual(result.brief.permissionsRequired, []);
});

test("requires confirmation for explicit destructive actions", () => {
  const result = compilePrompt({
    prompt: "Delete the temporary file after verifying its path.",
  });
  assert.equal(result.status, "confirmation_required");
  assert.deepEqual(result.brief.permissionsRequired, ["destructive_change"]);
});

test("does not convert a negated deployment into permission to deploy", () => {
  const result = compilePrompt({
    prompt: "Build the API but do not deploy it.",
  });
  assert.equal(result.status, "ready");
  assert.equal(result.classification, "implementation");
  assert.doesNotMatch(
    result.brief.permissionsRequired.join(" "),
    /external_side_effect/,
  );
});

test("asks for clarification when an external target is missing", () => {
  const result = compilePrompt({ prompt: "Send this" });
  assert.equal(result.status, "clarification_needed");
  assert.ok(result.clarificationQuestion);
});

test("redacts likely secrets from the execution brief", () => {
  const result = compilePrompt({
    prompt: "Debug api_key=supersecretvalue1234567890 safely.",
  });
  assert.doesNotMatch(result.effectivePrompt, /supersecretvalue1234567890/);
  assert.match(result.warnings.join(" "), /redacted/i);
});

test("built-in evaluation suite passes", () => {
  const report = runEvaluation();
  assert.equal(report.failed, 0, JSON.stringify(report, null, 2));
});
