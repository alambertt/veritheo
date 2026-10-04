// import { zhipu } from 'zhipu-ai-provider';
import { score } from "@typesafe-ai/sdk";
import { google } from "@ai-sdk/google";
import { GOOGLE_MODEL_LATEST } from "../constants";
import { heresyPrompt } from "../prompts/heresy";
import {
  generateTextResponse,
  type PartialTextOptions,
} from "./generate-text-response";
import { logTokenUsage } from "./token-usage";
import {
  logTypeSafeDecision,
  runTypeSafeJudgment,
  TYPESAFE_MIN_CONFIDENCE,
} from "./typesafe";

const HERESY_SELECTION_LIMIT = 10;
const HERESY_MIN_DOCTRINAL_SCORE = 1;

const HERESY_SCORE_LEVELS = [
  "No clear doctrinal claim or theological position.",
  "A possible doctrinal claim or theological position appears.",
  "A clear doctrinal claim or theological position appears and can inform a historical comparison.",
] as const;

type HeresyScoreAnswer = {
  score: number;
  confidence: number;
};

export interface HeresyOptions {
  authorName?: string;
  chatTitle?: string;
  messages: string[];
}

export async function selectHeresyMessages(
  messages: string[],
): Promise<string[] | undefined> {
  if (messages.length === 0) {
    return [];
  }

  const questions = Object.fromEntries(
    messages.map((_, index) => [
      `message_${index}`,
      score(
        "How strong is the doctrinal signal in this message for identifying a historical theological position?",
        HERESY_SCORE_LEVELS,
      ),
    ]),
  );
  const judgment = await runTypeSafeJudgment(
    "heresy-selection",
    {
      state: {
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
      ] as HeresyScoreAnswer;
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
        candidate.score >= HERESY_MIN_DOCTRINAL_SCORE,
    )
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, HERESY_SELECTION_LIMIT);

  const selectedIndexes = new Set(ranked.map((candidate) => candidate.index));
  const selectedMessages = messages.filter((_, index) => selectedIndexes.has(index));
  const confidence = ranked.length
    ? Math.min(...ranked.map((candidate) => candidate.confidence))
    : undefined;
  logTypeSafeDecision("heresy-selection", {
    decision: selectedMessages.length ? `selected:${selectedMessages.length}` : "insufficient",
    confidence,
    candidateCount: messages.length,
  });

  return selectedMessages;
}

export async function detectUserHeresy(
  options: HeresyOptions,
  streamOptions?: PartialTextOptions,
) {
  const contextLines: string[] = [];
  if (options.authorName) {
    contextLines.push(`Autor o remitente: ${options.authorName}`);
  }
  if (options.chatTitle) {
    contextLines.push(`Conversación: ${options.chatTitle}`);
  }

  const messagesBlock = options.messages
    .map((message) => `- ${message}`)
    .join("\n");

  const userContent = [
    "Analiza los mensajes y determina la herejía histórica cuyo espíritu más se alinea con el usuario.",
    "Sigue estrictamente las instrucciones del sistema.",
    contextLines.length ? contextLines.join("\n") : null,
    "---",
    "Mensajes del usuario:",
    messagesBlock,
    "---",
  ]
    .filter(Boolean)
    .join("\n");

  const { text, usage } = await generateTextResponse(
    {
      // model: zhipu(ZHIPU_MODEL),
      model: google(GOOGLE_MODEL_LATEST),
      system: heresyPrompt,
      providerOptions: {
        google: {
          serviceTier: 'flex',
        },
      },
      // One SDK retry, with a single deadline covering requests and backoff.
      maxRetries: 1,
      timeout: { totalMs: 60_000 },
      messages: [{ role: "user", content: userContent }],
    },
    streamOptions,
  );
  logTokenUsage("/my_heresy", usage);

  return { text };
}
