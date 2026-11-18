const GEMINI_DECISIONS_URL = "https://generativelanguage.googleapis.com/v1beta/decisions";
const GEMINI_DECISIONS_MODEL = "gemini-decision-1";
const GEMINI_DECISIONS_TIMEOUT_MS = 3_000;
export const GEMINI_DECISIONS_MIN_CONFIDENCE = 0.85;

type DecisionsFeature =
  | "self-message-guard"
  | "roast-preflight"
  | "heresy-selection"
  | "theology-poll-validation"
  | "verify-claims"
  | "group-context-ranking"
  | "reply-routing"
  | "spam-guard"
  | "prompt-injection-guard";

type NoulCriteria = { true_description: string; false_description: string };

export function noul(instructions: string, criteria?: NoulCriteria) {
  return { type: "noul" as const, instructions, criteria };
}

export function choice(instructions: string, criteria: Record<string, string>) {
  return { type: "choice" as const, instructions, criteria };
}

export function score(instructions: string, criteria: readonly [string, string, ...string[]]) {
  return { type: "score" as const, instructions, criteria };
}

type Question = ReturnType<typeof noul | typeof choice | typeof score>;
export type Questions = Record<string, Question>;

type AnswerByType = {
  noul: { type: "noul"; noul: number };
  choice: { type: "choice"; choice: string; confidence: number };
  score: { type: "score"; score: number; confidence: number };
};

type Answers<Q extends Questions> = { [K in keyof Q]: AnswerByType[Q[K]["type"]] };

let missingKeyWarningShown = false;

function isFeatureActive(feature: DecisionsFeature): boolean {
  if (feature === "reply-routing") {
    return true;
  }
  const suffix = feature.toUpperCase().replaceAll("-", "_");
  const value = (
    process.env[`GEMINI_DECISIONS_${suffix}`] ?? process.env[`TYPESAFE_${suffix}`]
  )?.trim().toLowerCase();
  return value === "on" || value === "active";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1;
}

function isValidAnswer(question: Question, answer: unknown): boolean {
  if (!isRecord(answer) || answer.type !== question.type) {
    return false;
  }
  if (question.type === "noul") {
    return isProbability(answer.noul);
  }
  if (!isProbability(answer.confidence)) {
    return false;
  }
  if (question.type === "choice") {
    return typeof answer.choice === "string" && Object.hasOwn(question.criteria, answer.choice);
  }
  return typeof answer.score === "number" &&
    answer.score >= 0 && answer.score <= question.criteria.length - 1;
}

export async function runGeminiDecision<Q extends Questions>(
  feature: DecisionsFeature,
  request: { state: object; questions: Q },
  metadata: { candidateCount?: number } = {},
): Promise<{ answers: Answers<Q> } | undefined> {
  if (!isFeatureActive(feature)) {
    return undefined;
  }

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!apiKey) {
    if (!missingKeyWarningShown) {
      missingKeyWarningShown = true;
      console.warn("[Gemini Decisions] Active features need GOOGLE_GENERATIVE_AI_API_KEY; using current behavior.");
    }
    return undefined;
  }

  const startedAt = performance.now();
  let status: number | undefined;
  try {
    const response = await fetch(GEMINI_DECISIONS_URL, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GEMINI_DECISIONS_MODEL,
        input: JSON.stringify(request.state),
        questions: request.questions,
      }),
      signal: AbortSignal.timeout(GEMINI_DECISIONS_TIMEOUT_MS),
      redirect: "error",
    });
    status = response.status;
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Gemini Decisions request failed");
    }
    const result: unknown = await response.json();
    if (!isRecord(result) || !isRecord(result.answers)) {
      throw new Error("Gemini Decisions response has no answers");
    }
    const answers = result.answers;
    for (const [id, question] of Object.entries(request.questions)) {
      if (!Object.hasOwn(answers, id) || !isValidAnswer(question, answers[id])) {
        throw new Error("Gemini Decisions response has an invalid answer");
      }
    }

    const usage = isRecord(result.usage) ? result.usage : {};
    console.info("[Gemini Decisions] completed", {
      feature,
      candidateCount: metadata.candidateCount,
      latencyMs: Math.round(performance.now() - startedAt),
      inputTokens: typeof usage.total_input_tokens === "number" ? usage.total_input_tokens : undefined,
      outputTokens: typeof usage.total_output_tokens === "number" ? usage.total_output_tokens : undefined,
    });
    return { answers: answers as Answers<Q> };
  } catch (error) {
    console.warn("[Gemini Decisions] unavailable; using current behavior", {
      feature,
      candidateCount: metadata.candidateCount,
      latencyMs: Math.round(performance.now() - startedAt),
      status,
      error: error instanceof Error ? error.name : "UnknownError",
    });
    return undefined;
  }
}

export function logGeminiDecision(
  feature: DecisionsFeature,
  details: {
    decision: string;
    confidence?: number;
    probability?: number;
    candidateCount?: number;
    modelTier?: string;
  },
): void {
  console.info("[Gemini Decisions] decision", { feature, ...details });
}
