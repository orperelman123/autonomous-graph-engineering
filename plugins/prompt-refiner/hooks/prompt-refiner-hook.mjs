import {
  buildHookFailureResponse,
  buildHookResponse,
  collectContext,
  refinePrompt,
} from "../runtime/index.js";

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(Buffer.from(chunk));
}

try {
  const input = JSON.parse(
    Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, ""),
  );
  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  if (!prompt || prompt.trimStart().startsWith("!raw")) {
    process.stdout.write(JSON.stringify({ continue: true }));
    process.exit(0);
  }

  const result = await refinePrompt({
    prompt,
    mode: "auto",
    context: await collectContext(
      typeof input.cwd === "string" ? input.cwd : process.cwd(),
    ),
    semantic: process.env.PROMPT_REFINER_SEMANTIC === "true",
  });

  process.stdout.write(
    JSON.stringify(
      buildHookResponse(
        typeof input.hook_event_name === "string"
          ? input.hook_event_name
          : "UserPromptSubmit",
        result,
      ),
    ),
  );
} catch {
  process.stdout.write(JSON.stringify(buildHookFailureResponse()));
}
