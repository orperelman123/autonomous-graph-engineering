const runtimeUrl =
  process.env.PROMPT_REFINER_RUNTIME_URL ??
  new URL("../runtime/index.js", import.meta.url).href;

const chunks = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));

try {
  const { collectContext, refinePrompt } = await import(runtimeUrl);
  const input = JSON.parse(
    Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, ""),
  );
  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  if (!prompt || prompt.trimStart().startsWith("!raw")) {
    process.stdout.write("{}");
    process.exit(0);
  }
  const result = await refinePrompt({
    prompt,
    mode: "auto",
    context: await collectContext(
      typeof input.cwd === "string" ? input.cwd : process.cwd(),
    ),
    semantic: false,
  });
  let modified = result.effectivePrompt;
  if (result.status === "clarification_needed") {
    modified =
      `Do not execute the request yet. Ask exactly this clarification: ${result.clarificationQuestion}`;
  } else if (result.status === "confirmation_required") {
    modified =
      `Do not perform the consequential action yet. ${result.confirmationReason} Surface the exact target and side effect, then request explicit confirmation.`;
  }
  process.stdout.write(
    JSON.stringify({ modifiedTransformedPrompt: modified }),
  );
} catch {
  process.stdout.write(
    JSON.stringify({
      modifiedTransformedPrompt:
        "Prompt Refiner failed closed. Do not act on this request. Ask the user to repair the integration or resubmit with !raw for a deliberate one-turn bypass.",
    }),
  );
}
