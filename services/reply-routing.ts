import { choice, score } from "@typesafe-ai/sdk";
import {
  logTypeSafeDecision,
  runTypeSafeJudgment,
} from "./typesafe";
import type { ReplyModelTier, ReplyStrategy } from "./sqlite";

export const REPLY_ROUTING_MIN_CONFIDENCE = 0.65;
export const REPLY_ROUTING_FAST_SCORE_MAX = 0.25;
export const REPLY_ROUTING_COMPLEXITY_MIN_CONFIDENCE = 0.7;

export type ReplyRoutingAction = ReplyStrategy | "ignore";
export type ReplyRoutingClassification = {
  action: ReplyRoutingAction;
  confidence: number;
  modelTier: ReplyModelTier;
};

export type ReplyRoutingState = {
  previousMessages: Array<{ speaker: "bot" | "user"; text: string }>;
  botMessage: string;
  userReply: string;
};

export type ReplyHistoryMessage = {
  text?: string;
  from_is_bot?: boolean;
};

export function buildReplyRoutingState(params: {
  previousMessages: ReplyHistoryMessage[];
  botMessage: string;
  userReply: string;
}): ReplyRoutingState {
  return {
    previousMessages: params.previousMessages.flatMap((message) => {
      const text = message.text?.trim();
      return text
        ? [
            {
              speaker: message.from_is_bot ? ("bot" as const) : ("user" as const),
              text,
            },
          ]
        : [];
    }),
    botMessage: params.botMessage.trim(),
    userReply: params.userReply.trim(),
  };
}

const REPLY_ROUTING_QUESTION = {
  action: choice(
    "Choose the best response strategy for Veritheo based on the conversation, the bot message being replied to, and the user's reply. Choose ignore when the reply is vague, low-value, or only reacts to a command or operational notice without adding useful context.",
    {
      playful: {
        meaning:
          "A joke or playful comment that merits a brief, friendly response.",
        not_this:
          "A bare reaction with no conversational value; choose ignore instead.",
        examples: ["Jaja, era broma 😄", "Me ganaste con esa respuesta."],
      },
      add_context: {
        meaning:
          "Relevant details that change or refine the meaning of the previous exchange.",
        examples: [
          "Cuando dije iglesia, me refería a la comunidad de mi ciudad.",
          "Me faltó decir que esto ocurrió antes del concilio.",
        ],
      },
      follow_up: {
        meaning:
          "A question that depends on or explores Veritheo's previous answer.",
        examples: ["¿Y cómo se entiende eso en Romanos 8?"],
      },
      disagreement: {
        meaning:
          "A challenge, correction, or reasoned disagreement with a substantive point in the previous answer.",
        examples: ["Creo que esa cita no dice eso en su contexto."],
      },
      new_topic: {
        meaning:
          "A new, answerable question that does not depend on the previous exchange.",
        examples: ["Cambiando de tema, ¿qué significa hesed?"],
      },
      general: {
        meaning:
          "Another meaningful conversational reply that deserves a concise response.",
        examples: ["Eso aclara lo que estaba pensando."],
      },
      ignore: {
        meaning:
          "A vague or purely reactive reply, or a reply to a command or operational notice that adds no useful context.",
        examples: ["Ok", "Jaja", "👍"],
      },
    },
  ),
  complexity: score(
    "Rate the reasoning needed to answer the user's reply well. Judge the actual argument and context, not the label or emotional tone. A plain joke, simple acknowledgement, or clear context correction needs little reasoning. A reply needs more reasoning when it disputes interpretation, combines theological claims, or needs careful comparison of evidence. Use the lowest score that still supports an accurate, respectful answer.",
    [
      "A short, straightforward response is enough. No careful analysis or source comparison is needed.",
      "The answer needs careful reasoning, theological interpretation, or comparison of claims and evidence.",
    ],
  ),
};

export const REPLY_SYSTEM_INSTRUCTIONS: Record<ReplyStrategy, string> = {
  playful:
    "The user is making a joke or playful comment. Respond briefly and warmly. Match the light tone without mocking the user or escalating the joke.",
  add_context:
    "The user has added context to the previous exchange. Use that context to refine or continue your answer. Do not repeat the previous answer unless needed.",
  follow_up:
    "The user asks a follow-up question. Answer it directly using the previous exchange as context.",
  disagreement:
    "The user challenges or corrects your previous answer. Reassess the point fairly, address the objection, and acknowledge any mistake plainly.",
  new_topic:
    "The user has introduced a new question. Answer it as a new request. Use the previous exchange only if it is relevant.",
  general:
    "Respond naturally and concisely to the user's meaningful reply, using the conversation context where it helps.",
};

export async function classifyBotReply(
  state: ReplyRoutingState,
): Promise<ReplyRoutingClassification | undefined> {
  const result = await runTypeSafeJudgment(
    "reply-routing",
    { state, questions: REPLY_ROUTING_QUESTION },
    { candidateCount: state.previousMessages.length + 2 },
  );
  const answer = result?.answers.action;
  const complexity = result?.answers.complexity;
  if (
    !answer ||
    !Number.isFinite(answer.confidence) ||
    !(Object.hasOwn(REPLY_SYSTEM_INSTRUCTIONS, answer.choice) ||
      answer.choice === "ignore")
  ) {
    return undefined;
  }

  const action = answer.choice as ReplyRoutingAction;
  const modelTier: ReplyModelTier =
    complexity &&
    Number.isFinite(complexity.score) &&
    complexity.score >= 0 &&
    complexity.score <= 1 &&
    Number.isFinite(complexity.confidence) &&
    complexity.confidence >= REPLY_ROUTING_COMPLEXITY_MIN_CONFIDENCE &&
    complexity.score <= REPLY_ROUTING_FAST_SCORE_MAX
      ? "fast"
      : "reasoning";
  logTypeSafeDecision("reply-routing", {
    decision: action,
    confidence: answer.confidence,
    modelTier,
  });
  return { action, confidence: answer.confidence, modelTier };
}

export function shouldRespondToBotReply(classification: {
  action: ReplyRoutingAction;
  confidence: number;
}): classification is { action: ReplyStrategy; confidence: number } {
  return (
    classification.action !== "ignore" &&
    classification.confidence >= REPLY_ROUTING_MIN_CONFIDENCE
  );
}
