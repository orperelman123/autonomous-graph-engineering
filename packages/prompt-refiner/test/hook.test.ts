import assert from "node:assert/strict";
import test from "node:test";
import { compilePrompt } from "../src/compiler.js";
import {
  buildHookFailureResponse,
  buildHookResponse,
} from "../src/hook.js";

test("hook adds context only for prompts that are ready", () => {
  const response = buildHookResponse(
    "UserPromptSubmit",
    compilePrompt({ prompt: "Build a health endpoint." }),
  ) as {
    continue?: boolean;
    hookSpecificOutput?: { additionalContext?: string };
  };
  assert.equal(response.continue, true);
  assert.match(
    response.hookSpecificOutput?.additionalContext ?? "",
    /EXECUTION BRIEF/,
  );
});

test("hook blocks prompts that require clarification", () => {
  const response = buildHookResponse(
    "UserPromptSubmit",
    compilePrompt({ prompt: "Send this" }),
  ) as { decision?: string; reason?: string };
  assert.equal(response.decision, "block");
  assert.match(response.reason ?? "", /target|destination/i);
});

test("hook blocks prompts that require consequential confirmation", () => {
  const response = buildHookResponse(
    "UserPromptSubmit",
    compilePrompt({
      prompt: "Delete the temporary file after verifying its path.",
    }),
  ) as { decision?: string; reason?: string };
  assert.equal(response.decision, "block");
  assert.match(response.reason ?? "", /confirmation|required|confirm/i);
});

test("hook failures block instead of bypassing refinement", () => {
  const response = buildHookFailureResponse();
  assert.equal(response.decision, "block");
  assert.match(response.reason, /could not safely process|!raw/i);
});
