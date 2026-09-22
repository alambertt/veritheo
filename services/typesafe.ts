import {
  TypeSafeClient,
  type Questions,
  type RequestOptions,
  type SystemOneRequest,
  type SystemOneResult,
} from "@typesafe-ai/sdk";

export const TYPESAFE_MIN_CONFIDENCE = 0.85;
export const TYPESAFE_TIMEOUT_MS = 3_000;

export type TypeSafeFeature =
  | "self-message-guard"
  | "roast-preflight"
  | "heresy-selection"
  | "theology-poll-validation"
  | "verify-claims"
  | "group-context-ranking";

const FEATURE_ENV_NAMES: Record<TypeSafeFeature, string> = {
  "self-message-guard": "TYPESAFE_SELF_MESSAGE_GUARD",
  "roast-preflight": "TYPESAFE_ROAST_PREFLIGHT",
  "heresy-selection": "TYPESAFE_HERESY_SELECTION",
  "theology-poll-validation": "TYPESAFE_THEOLOGY_POLL_VALIDATION",
  "verify-claims": "TYPESAFE_VERIFY_CLAIMS",
  "group-context-ranking": "TYPESAFE_GROUP_CONTEXT_RANKING",
};

export type TypeSafeSystemOne = <Q extends Questions>(
  request: SystemOneRequest<Q>,
  options?: RequestOptions,
) => Promise<SystemOneResult<Q>>;

let client: TypeSafeClient | undefined;
let testSystemOne: TypeSafeSystemOne | undefined;
let missingKeyWarningShown = false;

export function isTypeSafeFeatureActive(feature: TypeSafeFeature): boolean {
  const value = process.env[FEATURE_ENV_NAMES[feature]]?.trim().toLowerCase();
  return value === "on" || value === "active";
}

function getClient(): TypeSafeClient | undefined {
  if (client) {
    return client;
  }

  const apiKey = process.env.TYPESAFE_API_KEY?.trim();
  if (!apiKey) {
    if (!missingKeyWarningShown) {
      missingKeyWarningShown = true;
      console.warn("[TypeSafe] Active features need TYPESAFE_API_KEY; using current behavior.");
    }
    return undefined;
  }

  client = new TypeSafeClient({
    apiKey,
    timeout: TYPESAFE_TIMEOUT_MS,
    logLevel: "off",
    retry: {
      maxRetries: 0,
    },
  });
  return client;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

export async function runTypeSafeJudgment<Q extends Questions>(
  feature: TypeSafeFeature,
  request: SystemOneRequest<Q>,
  metadata: { candidateCount?: number } = {},
): Promise<SystemOneResult<Q> | undefined> {
  if (!isTypeSafeFeatureActive(feature)) {
    return undefined;
  }

  let systemOne: TypeSafeSystemOne | undefined;
  try {
    systemOne = testSystemOne ?? getClientSystemOne();
  } catch (error) {
    console.warn("[TypeSafe] client setup failed; using current behavior", {
      feature,
      error: errorName(error),
    });
    return undefined;
  }
  if (!systemOne) {
    return undefined;
  }

  const startedAt = performance.now();
  try {
    const result = await systemOne(request, {
      timeout: TYPESAFE_TIMEOUT_MS,
      retry: { maxRetries: 0 },
    });
    console.info("[TypeSafe] completed", {
      feature,
      candidateCount: metadata.candidateCount,
      latencyMs: Math.round(performance.now() - startedAt),
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
    });
    return result;
  } catch (error) {
    console.warn("[TypeSafe] unavailable; using current behavior", {
      feature,
      candidateCount: metadata.candidateCount,
      latencyMs: Math.round(performance.now() - startedAt),
      error: errorName(error),
    });
    return undefined;
  }
}

function getClientSystemOne(): TypeSafeSystemOne | undefined {
  const currentClient = getClient();
  return currentClient
    ? (currentClient.systemOne.bind(currentClient) as TypeSafeSystemOne)
    : undefined;
}

export function logTypeSafeDecision(
  feature: TypeSafeFeature,
  details: {
    decision: string;
    confidence?: number;
    probability?: number;
    candidateCount?: number;
  },
): void {
  console.info("[TypeSafe] decision", {
    feature,
    decision: details.decision,
    confidence: details.confidence,
    probability: details.probability,
    candidateCount: details.candidateCount,
  });
}

export function setTypeSafeSystemOneForTests(
  systemOne: TypeSafeSystemOne | undefined,
): void {
  testSystemOne = systemOne;
}

export function resetTypeSafeClientForTests(): void {
  client = undefined;
  testSystemOne = undefined;
  missingKeyWarningShown = false;
}
