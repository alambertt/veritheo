import { noul } from "@typesafe-ai/sdk";
import { logTypeSafeDecision, runTypeSafeJudgment } from "./typesafe";

// A ban is hard to undo for the user, so this needs more certainty than other judgments.
export const SPAM_BAN_MIN_PROBABILITY = 0.95;

export async function isSpamMessage(message: string): Promise<boolean> {
  const judgment = await runTypeSafeJudgment("spam-guard", {
    state: { message },
    questions: {
      spam: noul(
        "In any language, is this message unsolicited commercial spam, such as selling ads, promoting traffic or user growth, crypto/USDT offers, coupons, or links to buy something, with no real question or conversation for a theology bot?",
        {
          true: "The message is promotional spam sent to the bot.",
          false: "The message is a normal question, conversation, or unclear.",
        },
      ),
    },
  });

  if (!judgment) {
    return false;
  }

  const probability = judgment.answers.spam.noul;
  const isSpam = probability >= SPAM_BAN_MIN_PROBABILITY;
  logTypeSafeDecision("spam-guard", {
    decision: isSpam ? "spam" : "not-spam",
    probability,
  });
  return isSpam;
}
