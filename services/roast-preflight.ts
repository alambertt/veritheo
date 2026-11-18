import {
  logGeminiDecision,
  noul,
  runGeminiDecision,
  GEMINI_DECISIONS_MIN_CONFIDENCE,
} from "./gemini-decisions";

export type RoastRoute = "scripture" | "core-doctrine" | "argument";

export async function classifyRoastMessage(
  message: string,
): Promise<RoastRoute | undefined> {
  const judgment = await runGeminiDecision("roast-preflight", {
    state: { message },
    questions: {
      scripture: noul(
        "Is the message mainly a literal or near-literal Bible passage rather than an argument to roast?",
        {
          true_description: "The message is mainly scripture and should receive the scripture refusal.",
          false_description: "The message is not mainly scripture.",
        },
      ),
      coreDoctrineAttack: noul(
        "Does the message try to ridicule, discredit, or attack a first-order Christian doctrine?",
        {
          true_description: "The message attacks a core doctrine and needs a firm rebuke, not a roast.",
          false_description: "The message does not attack a core doctrine.",
        },
      ),
      hasArgument: noul(
        "Does the message contain a claim or argument that can be answered with a theological refutation?",
        {
          true_description: "The message contains an argument that can be roasted.",
          false_description: "The message does not contain a clear argument.",
        },
      ),
    },
  });

  if (!judgment) {
    return undefined;
  }

  const answers = judgment.answers;
  const scriptureProbability = answers.scripture.noul;
  const doctrineProbability = answers.coreDoctrineAttack.noul;
  const argumentProbability = answers.hasArgument.noul;
  const route =
    scriptureProbability >= GEMINI_DECISIONS_MIN_CONFIDENCE
      ? "scripture"
      : doctrineProbability >= GEMINI_DECISIONS_MIN_CONFIDENCE
        ? "core-doctrine"
        : argumentProbability >= GEMINI_DECISIONS_MIN_CONFIDENCE
          ? "argument"
          : undefined;

  logGeminiDecision("roast-preflight", {
    decision: route ?? "uncertain",
    probability: Math.max(
      scriptureProbability,
      doctrineProbability,
      argumentProbability,
    ),
  });
  return route;
}

export function buildRoastPolicyInstruction(
  route: RoastRoute | undefined,
): string | undefined {
  switch (route) {
    case "scripture":
      return "Preflight policy: treat this as a Bible passage. Decline briefly and politely instead of roasting it.";
    case "core-doctrine":
      return "Preflight policy: this attacks a first-order Christian doctrine. Give the firm doctrinal rebuke required by the system prompt, not a roast.";
    case "argument":
      return "Preflight policy: this contains a theological argument. Roast the argument, not the person.";
    default:
      return undefined;
  }
}
