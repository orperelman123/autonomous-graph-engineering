import assert from "node:assert/strict";
import test from "node:test";
import { parseWrapperArguments } from "../src/wrapper.js";

test("wrapper options are not injected into the refined prompt", () => {
  assert.deepEqual(
    parseWrapperArguments([
      "--semantic",
      "--dry-run",
      "Review",
      "package.json",
    ]),
    {
      prompt: "Review package.json",
      semantic: true,
      dryRun: true,
    },
  );
});

test("wrapper option parsing supports an explicit prompt boundary", () => {
  assert.deepEqual(
    parseWrapperArguments(["--dry-run", "--", "--literal", "value"]),
    {
      prompt: "--literal value",
      semantic: false,
      dryRun: true,
    },
  );
  assert.throws(
    () => parseWrapperArguments(["--unknown", "prompt"]),
    /unsupported wrapper option/,
  );
});
