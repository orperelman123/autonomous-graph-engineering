import assert from "node:assert/strict";
import test from "node:test";
import { refinePrompt } from "../src/provider.js";

test("semantic provider payload excludes raw secrets", async (t) => {
  const originalFetch = globalThis.fetch;
  const previous = {
    provider: process.env.PROMPT_REFINER_PROVIDER,
    model: process.env.PROMPT_REFINER_MODEL,
    apiKey: process.env.OPENAI_API_KEY,
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [name, value] of [
      ["PROMPT_REFINER_PROVIDER", previous.provider],
      ["PROMPT_REFINER_MODEL", previous.model],
      ["OPENAI_API_KEY", previous.apiKey],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  process.env.PROMPT_REFINER_PROVIDER = "openai";
  process.env.PROMPT_REFINER_MODEL = "test-model";
  process.env.OPENAI_API_KEY = "test-provider-key";

  const secret = "supersecretvalue1234567890";
  let requestBody = "";
  globalThis.fetch = async (_input, init) => {
    requestBody = String(init?.body ?? "");
    const payload = JSON.parse(requestBody) as { input: string };
    const projection = JSON.parse(payload.input) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        output: [{ content: [{ text: JSON.stringify(projection) }] }],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  const result = await refinePrompt({
    prompt: `Review api_key=${secret} safely.`,
    semantic: true,
  });

  assert.doesNotMatch(requestBody, new RegExp(secret));
  assert.equal(result.originalPrompt, `Review api_key=${secret} safely.`);
  assert.doesNotMatch(result.effectivePrompt, new RegExp(secret));
  assert.equal(result.provider, "openai");
});

test("semantic provider cannot add or remove required permissions", async (t) => {
  const originalFetch = globalThis.fetch;
  const previous = {
    provider: process.env.PROMPT_REFINER_PROVIDER,
    model: process.env.PROMPT_REFINER_MODEL,
    apiKey: process.env.OPENAI_API_KEY,
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [name, value] of [
      ["PROMPT_REFINER_PROVIDER", previous.provider],
      ["PROMPT_REFINER_MODEL", previous.model],
      ["OPENAI_API_KEY", previous.apiKey],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  process.env.PROMPT_REFINER_PROVIDER = "openai";
  process.env.PROMPT_REFINER_MODEL = "test-model";
  process.env.OPENAI_API_KEY = "test-provider-key";
  let addPermission = false;
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body ?? "")) as {
      input: string;
    };
    const projection = JSON.parse(payload.input) as {
      brief: { permissionsRequired: string[] };
    };
    projection.brief.permissionsRequired = addPermission
      ? ["elevated_access"]
      : [];
    return new Response(
      JSON.stringify({
        output: [{ content: [{ text: JSON.stringify(projection) }] }],
      }),
      { status: 200 },
    );
  };

  const result = await refinePrompt({
    prompt: "Build the service with sudo access.",
    semantic: true,
  });
  assert.equal(result.provider, "deterministic");
  assert.deepEqual(result.brief.permissionsRequired, ["elevated_access"]);
  assert.match(result.warnings.join(" "), /changed required permissions/i);

  addPermission = true;
  const safe = await refinePrompt({
    prompt: "Investigate the root cause of the parser bug.",
    semantic: true,
  });
  assert.equal(safe.provider, "deterministic");
  assert.deepEqual(safe.brief.permissionsRequired, []);
  assert.match(safe.warnings.join(" "), /changed required permissions/i);
});

test("semantic provider cannot invent project context", async (t) => {
  const originalFetch = globalThis.fetch;
  const previous = {
    provider: process.env.PROMPT_REFINER_PROVIDER,
    model: process.env.PROMPT_REFINER_MODEL,
    apiKey: process.env.OPENAI_API_KEY,
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [name, value] of [
      ["PROMPT_REFINER_PROVIDER", previous.provider],
      ["PROMPT_REFINER_MODEL", previous.model],
      ["OPENAI_API_KEY", previous.apiKey],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  process.env.PROMPT_REFINER_PROVIDER = "openai";
  process.env.PROMPT_REFINER_MODEL = "test-model";
  process.env.OPENAI_API_KEY = "test-provider-key";
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body ?? "")) as {
      input: string;
    };
    const projection = JSON.parse(payload.input) as {
      brief: { context: string[] };
    };
    projection.brief.context.push("Project: invented-project");
    return new Response(
      JSON.stringify({
        output: [{ content: [{ text: JSON.stringify(projection) }] }],
      }),
      { status: 200 },
    );
  };

  const result = await refinePrompt({
    prompt: "Review the parser.",
    semantic: true,
  });
  assert.equal(result.provider, "deterministic");
  assert.deepEqual(result.brief.context, []);
  assert.match(result.warnings.join(" "), /changed protected context/i);
});

test("semantic refinement cannot bypass the effective-prompt byte budget", async (t) => {
  const originalFetch = globalThis.fetch;
  const previous = {
    provider: process.env.PROMPT_REFINER_PROVIDER,
    model: process.env.PROMPT_REFINER_MODEL,
    apiKey: process.env.OPENAI_API_KEY,
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [name, value] of [
      ["PROMPT_REFINER_PROVIDER", previous.provider],
      ["PROMPT_REFINER_MODEL", previous.model],
      ["OPENAI_API_KEY", previous.apiKey],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  process.env.PROMPT_REFINER_PROVIDER = "openai";
  process.env.PROMPT_REFINER_MODEL = "test-model";
  process.env.OPENAI_API_KEY = "test-provider-key";
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body ?? "")) as {
      input: string;
    };
    const projection = JSON.parse(payload.input) as {
      brief: { requirements: string[] };
    };
    projection.brief.requirements.push("x".repeat(1_048_576));
    return new Response(
      JSON.stringify({
        output: [{ content: [{ text: JSON.stringify(projection) }] }],
      }),
      { status: 200 },
    );
  };

  const result = await refinePrompt({
    prompt: "Review the parser implementation.",
    semantic: true,
  });
  assert.equal(result.provider, "deterministic");
  assert.match(result.warnings.join(" "), /effective prompt exceeds/i);
  assert.ok(Buffer.byteLength(result.effectivePrompt, "utf8") < 1_048_576);
});
