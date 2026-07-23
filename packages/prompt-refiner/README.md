# @autonomous-graph-engineering/prompt-refiner

Intent-preserving prompt compilation for autonomous agent workflows.

```ts
import { compilePrompt } from "@autonomous-graph-engineering/prompt-refiner";

const result = compilePrompt({
  prompt: "Audit this service without changing files.",
});
```

The deterministic compiler is local and requires no API key. Optional semantic refinement supports OpenAI and Anthropic with an explicit provider model.

See the [repository documentation](https://github.com/orperelman123/autonomous-graph-engineering).
