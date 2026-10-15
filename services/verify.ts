import { google } from "@ai-sdk/google";
import type { Tool } from "ai";
import { noul, score, type Questions } from "@typesafe-ai/sdk";
import { GOOGLE_MODEL_LATEST } from "../constants";
import { verifyPrompt } from "../prompts/verify";
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

export const VERIFY_CLAIM_LIMIT = 12;

type VerifyClaimAnswer = {
  noul?: number;
  score?: number;
  confidence?: number;
};

export interface VerifyMessageOptions {
  authorName?: string;
  chatTitle?: string;
}

export function splitVerifyClaimCandidates(message: string): string[] {
  const parts = message
    .split(/\n{2,}|\n|(?<=[.!?¿¡])\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length <= VERIFY_CLAIM_LIMIT) {
    return parts.length > 0 ? parts : [message];
  }

  return [
    ...parts.slice(0, VERIFY_CLAIM_LIMIT - 1),
    parts.slice(VERIFY_CLAIM_LIMIT - 1).join(" "),
  ];
}

export async function selectVerifyClaims(
  message: string,
): Promise<string[] | undefined> {
  const candidates = splitVerifyClaimCandidates(message);
  const questions: Questions = {};
  for (const [index] of candidates.entries()) {
    questions[`checkable_${index}`] = noul(
      "Can this exact candidate be checked against external theological evidence or a primary source?",
    );
    questions[`priority_${index}`] = score(
      "How important is this candidate to verify in the final response?",
      [
        "Low priority: background, opinion, or a claim that does not affect the conclusion.",
        "Medium priority: a relevant claim that affects part of the conclusion.",
        "High priority: the central claim whose truth strongly affects the conclusion.",
      ],
    );
  }

  const judgment = await runTypeSafeJudgment(
    "verify-claims",
    {
      state: {
        claims: candidates.map((text, index) => ({
          id: String(index),
          text,
        })),
      },
      questions,
    },
    { candidateCount: candidates.length },
  );

  if (!judgment) {
    return undefined;
  }

  const ranked = candidates
    .map((text, index) => {
      const checkable = judgment.answers[
        `checkable_${index}`
      ] as VerifyClaimAnswer;
      const priority = judgment.answers[
        `priority_${index}`
      ] as VerifyClaimAnswer;
      return {
        index,
        text,
        checkable: checkable.noul ?? 0,
        score: priority.score ?? 0,
        confidence: priority.confidence ?? 0,
      };
    })
    .filter(
      (candidate) =>
        candidate.checkable >= TYPESAFE_MIN_CONFIDENCE &&
        candidate.confidence >= TYPESAFE_MIN_CONFIDENCE &&
        candidate.score >= 1,
    )
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selectedClaims = ranked.map((candidate) => candidate.text);
  const confidence = ranked.length
    ? Math.min(...ranked.map((candidate) => candidate.confidence))
    : undefined;
  logTypeSafeDecision("verify-claims", {
    decision: selectedClaims.length
      ? `selected:${selectedClaims.length}`
      : "current-message",
    confidence,
    candidateCount: candidates.length,
  });
  return selectedClaims;
}

export async function verifyMessageContent(
  message: string,
  options: VerifyMessageOptions = {},
  streamOptions?: PartialTextOptions,
) {
  const selectedClaims = await selectVerifyClaims(message);
  const messageToAnalyze = selectedClaims?.length
    ? ["Afirmaciones seleccionadas para verificar:", ...selectedClaims].join(
        "\n",
      )
    : message;
  const webSearchTool = google.tools.googleSearch({}) as Tool<any, any>;
  const contextLines: string[] = [];
  if (options.authorName) {
    contextLines.push(`Autor o remitente: ${options.authorName}`);
  }
  if (options.chatTitle) {
    contextLines.push(`Conversación: ${options.chatTitle}`);
  }

  const userContent = [
    "Analiza el siguiente mensaje a la luz de las instrucciones del sistema.",
    contextLines.length ? contextLines.join("\n") : null,
    "---",
    messageToAnalyze,
    "---",
  ]
    .filter(Boolean)
    .join("\n");

  const { text, usage } = await generateTextResponse(
    {
      model: google(GOOGLE_MODEL_LATEST),
      system: verifyPrompt,
      tools: {
        google_search: webSearchTool,
      },
      providerOptions: {
        google: {
          serviceTier: "standard",
          thinkingConfig: { thinkingLevel: "medium" },
        },
      },
      timeout: 600000, // 10-minute request deadline
      messages: [{ role: "user", content: userContent }],
    },
    streamOptions,
  );
  logTokenUsage("/verify", usage);

  return { text };
}
