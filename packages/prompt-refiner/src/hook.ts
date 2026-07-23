import type { RefinementResult } from "./types.js";

export function buildHookResponse(
  eventName: string,
  result: RefinementResult,
): unknown {
  if (result.status === "pass_through") {
    return { continue: true };
  }
  if (result.status === "clarification_needed") {
    return {
      decision: "block",
      reason:
        result.clarificationQuestion ??
        "Clarification is required before this prompt can be processed.",
    };
  }
  if (result.status === "confirmation_required") {
    return {
      decision: "block",
      reason:
        `${result.confirmationReason ?? "Explicit confirmation is required."} ` +
        "Confirm the exact target and side effect, then resubmit with !raw only if you intend to bypass refinement for that single prompt.",
    };
  }
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: result.effectivePrompt,
    },
  };
}

export function buildHookFailureResponse(): {
  decision: "block";
  reason: string;
} {
  return {
    decision: "block",
    reason:
      "Prompt Refiner could not safely process this prompt. Fix the integration error, or resubmit with !raw only if you intend to bypass refinement for this single prompt.",
  };
}
