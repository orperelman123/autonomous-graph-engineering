# @autonomous-graph-engineering/prompt-refiner

Intent-preserving prompt compilation for autonomous agent workflows.

```ts
import { compilePrompt } from "@autonomous-graph-engineering/prompt-refiner";

const result = compilePrompt({
  prompt: "Audit this service without changing files.",
});
```

Caller-supplied `context` is normalized and bounded at this compiler boundary.
Malformed or unknown fields fail closed, exact array duplicates are removed in
first-seen order, provenance is rendered explicitly, and final effective
prompts are limited by UTF-8 bytes. The same enforcement applies to semantic,
HTTP, MCP, hook, CLI, runner, and wrapper paths because they converge on the
compiler.

The deterministic compiler is local and requires no API key. Optional semantic refinement supports OpenAI and Anthropic with an explicit provider model.

See the [repository documentation](https://github.com/orperelman123/autonomous-graph-engineering).
