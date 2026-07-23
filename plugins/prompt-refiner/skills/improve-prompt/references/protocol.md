# Prompt Refiner protocol

The `refine_prompt` tool accepts:

```json
{
  "prompt": "Non-empty original request",
  "mode": "auto | silent | visible | strict",
  "semantic": false
}
```

Protected fields must remain unchanged during semantic refinement:

- `originalPrompt`
- `originalPromptHash`
- `status`
- `classification`
- `risk`
- `brief.permissionsRequired`

Statuses:

- `pass_through`: preserve a trivial conversational prompt.
- `ready`: proceed using the execution brief.
- `clarification_needed`: ask the returned question before execution.
- `confirmation_required`: show the exact target and side effect before acting.

The `!raw` prefix bypasses automatic hook refinement for one prompt.
