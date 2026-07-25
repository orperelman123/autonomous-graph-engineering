import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { collectContext } from "../src/context.js";
import { startServer } from "../src/server.js";

test("HTTP refinement and hook endpoints return structured results", async (t) => {
  const server = startServer({ host: "127.0.0.1", port: 0 });
  t.after(() => server.close());
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;

  const refineResponse = await fetch(`${base}/v1/refine`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Explain the architecture." }),
  });
  assert.equal(refineResponse.status, 200);
  const refined = (await refineResponse.json()) as {
    status?: string;
    brief?: { context?: string[] };
  };
  assert.equal(refined.status, "ready");
  assert.deepEqual(refined.brief?.context, []);

  const malformedContextResponse = await fetch(`${base}/v1/refine`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: "Review the parser.",
      context: { frameworks: ["typescript", 42] },
    }),
  });
  assert.equal(malformedContextResponse.status, 400);
  assert.match(
    JSON.stringify(await malformedContextResponse.json()),
    /context\.frameworks must contain only strings/,
  );

  const hookResponse = await fetch(`${base}/hooks/claude`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      prompt: "Build a health endpoint.",
      cwd: process.cwd(),
    }),
  });
  assert.equal(hookResponse.status, 200);
  const hook = (await hookResponse.json()) as {
    hookSpecificOutput?: { additionalContext?: string };
  };
  assert.match(
    hook.hookSpecificOutput?.additionalContext ?? "",
    /EXECUTION BRIEF/,
  );
  const expectedHookContext = await collectContext(process.cwd());
  assert.ok(
    (hook.hookSpecificOutput?.additionalContext ?? "").includes(
      `Project: ${expectedHookContext.projectName}`,
    ),
  );

  const contextlessHookResponse = await fetch(`${base}/hooks/codex`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      prompt: "Investigate the root cause of the parser bug.",
    }),
  });
  const contextlessHook = (await contextlessHookResponse.json()) as {
    hookSpecificOutput?: { additionalContext?: string };
  };
  assert.doesNotMatch(
    contextlessHook.hookSpecificOutput?.additionalContext ?? "",
    /Project:|Working directory:|elevated_access/,
  );

  for (const [prompt, reason] of [
    ["Send this", /target|destination/i],
    [
      "Delete the temporary file after verifying its path.",
      /confirmation|required|confirm/i,
    ],
  ] as const) {
    const blockedResponse = await fetch(`${base}/hooks/claude`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        hook_event_name: "UserPromptSubmit",
        prompt,
        cwd: process.cwd(),
      }),
    });
    assert.equal(blockedResponse.status, 200);
    const blocked = (await blockedResponse.json()) as {
      decision?: string;
      reason?: string;
    };
    assert.equal(blocked.decision, "block");
    assert.match(blocked.reason ?? "", reason);
  }

  const rawResponse = await fetch(`${base}/hooks/claude`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      prompt: "!raw Delete the temporary file.",
      cwd: process.cwd(),
    }),
  });
  assert.deepEqual(await rawResponse.json(), { continue: true });
});
