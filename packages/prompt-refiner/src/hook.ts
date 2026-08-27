import type { RefinementResult } from "./types.js";

/**
 * PROMPT_REFINER_GATE=off lets an operator keep prompt refinement while
 * disabling the blocking gates (clarification / confirmation). Prompts are
 * still refined into an execution brief and still carry their warnings - they
 * simply are not halted. Any value other than "off" keeps the gates on.
 */
function gatesEnabled(): boolean {
  return (process.env.PROMPT_REFINER_GATE ?? "on").toLowerCase() !== "off";
}

function briefResponse(eventName: string, result: RefinementResult): unknown {
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: result.effectivePrompt,
    },
  };
}

export function buildHookResponse(
  eventName: string,
  result: RefinementResult,
): unknown {
  if (result.status === "pass_through") {
    return { continue: true };
  }
  if (result.status === "clarification_needed") {
    if (!gatesEnabled()) return briefResponse(eventName, result);
    return {
      decision: "block",
      reason:
        result.clarificationQuestion ??
        "Clarification is required before this prompt can be processed.",
    };
  }
  if (result.status === "confirmation_required") {
    if (!gatesEnabled()) return briefResponse(eventName, result);
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
