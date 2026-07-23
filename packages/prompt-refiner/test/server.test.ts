import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
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
  const refined = (await refineResponse.json()) as Record<string, unknown>;
  assert.equal(refined.status, "ready");

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
});
