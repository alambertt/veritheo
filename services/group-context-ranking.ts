import { score } from "@typesafe-ai/sdk";
import {
  logTypeSafeDecision,
  runTypeSafeJudgment,
  TYPESAFE_MIN_CONFIDENCE,
} from "./typesafe";

const GROUP_CONTEXT_SELECTION_LIMIT = 5;

type ContextScoreAnswer = {
  score: number;
  confidence: number;
};

export async function rankGroupContextMessages(
  question: string,
  messages: string[],
): Promise<string[] | undefined> {
  if (!question.trim() || messages.length === 0) {
    return undefined;
  }

  const questions = Object.fromEntries(
    messages.map((_, index) => [
      `message_${index}`,
      score(
        "How useful is this previous group message for answering the user's current question?",
        [
          "Not useful: unrelated, decorative, or redundant context.",
          "Somewhat useful: related background but not needed for the answer.",
          "Directly useful: it contains facts or reasoning that should inform the answer.",
        ],
      ),
    ]),
  );
  const judgment = await runTypeSafeJudgment(
    "group-context-ranking",
    {
      state: {
        question,
        messages: messages.map((text, index) => ({
          id: String(index),
          text,
        })),
      },
      questions,
    },
    { candidateCount: messages.length },
  );

  if (!judgment) {
    return undefined;
  }

  const ranked = messages
    .map((text, index) => {
      const answer = judgment.answers[
        `message_${index}`
      ] as ContextScoreAnswer;
      return {
        index,
        text,
        score: answer.score,
        confidence: answer.confidence,
      };
    })
    .filter(
      (candidate) =>
        candidate.confidence >= TYPESAFE_MIN_CONFIDENCE &&
        candidate.score >= 1,
    )
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, GROUP_CONTEXT_SELECTION_LIMIT);

  if (ranked.length === 0) {
    logTypeSafeDecision("group-context-ranking", {
      decision: "current-context",
      candidateCount: messages.length,
    });
    return undefined;
  }

  const selectedIndexes = new Set(ranked.map((candidate) => candidate.index));
  const selectedMessages = messages.filter((_, index) => selectedIndexes.has(index));
  logTypeSafeDecision("group-context-ranking", {
    decision: `selected:${selectedMessages.length}`,
    confidence: Math.min(...ranked.map((candidate) => candidate.confidence)),
    candidateCount: messages.length,
  });
  return selectedMessages;
}
