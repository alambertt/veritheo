import { google } from "@ai-sdk/google";
import { xai } from "@ai-sdk/xai";
import type { Tool } from "ai";
import {
  GOOGLE_MODEL_BASIC,
  GOOGLE_MODEL_LATEST,
  GROK_REPLY_MODEL,
} from "../constants";
import {
  initialPrompt,
  neutralPostureInstruction,
} from "../prompts/initial";
import {
  generateTextResponse,
  type PartialTextOptions,
} from "./generate-text-response";
import { logTokenUsage } from "./token-usage";
import { buildPersonaInstruction, type PersonaSlug } from "./persona";
import { redactSecrets } from "./log-redaction";
import type { ReplyModelTier } from "./sqlite";

function buildAskMessages(question: string, messagesContext?: string[]) {
  return [
    ...(messagesContext?.map((msg) => ({
      role: "user" as const,
      content: msg,
    })) ?? []),
    { role: "user" as const, content: question },
  ];
}

function collectErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    const segments = [error.name, error.message];

    if ("cause" in error && error.cause) {
      segments.push(collectErrorDetails(error.cause));
    }

    return segments.filter(Boolean).join(" ");
  }

  return String(error);
}

function isGoogleTransientFailure(error: unknown) {
  const normalizedMessage = collectErrorDetails(error).toLowerCase();

  return (
    normalizedMessage.includes("ai_retryerror") ||
    normalizedMessage.includes("ai_nooutputgeneratederror") ||
    normalizedMessage.includes("high demand") ||
    normalizedMessage.includes("please try again later") ||
    normalizedMessage.includes("resource_exhausted") ||
    normalizedMessage.includes("cannot connect to api") ||
    normalizedMessage.includes("socket connection was closed unexpectedly") ||
    normalizedMessage.includes("socket hang up") ||
    normalizedMessage.includes("fetch failed") ||
    normalizedMessage.includes("network") ||
    normalizedMessage.includes("econnreset") ||
    normalizedMessage.includes("etimedout") ||
    normalizedMessage.includes("eai_again") ||
    /\b(408|409|425|429|500|502|503|504)\b/.test(normalizedMessage)
  );
}

export async function askHandler(
  question: string,
  messagesContext?: string[],
  options?: PartialTextOptions & {
    route?: string;
    persona?: PersonaSlug;
    responseInstruction?: string;
    replyModelTier?: ReplyModelTier;
  },
) {
  const messages = buildAskMessages(question, messagesContext);
  const route =
    options?.route ?? (messagesContext?.length ? "/ask_group" : "/ask");
  const personaInstruction = buildPersonaInstruction(options?.persona ?? "neutral");
  const personaPrompt = personaInstruction
    ? `${initialPrompt.replace(`\n${neutralPostureInstruction}`, "")}${personaInstruction}`
    : initialPrompt;
  const systemPrompt = options?.responseInstruction
    ? `${personaPrompt}\n\n${options.responseInstruction}`
    : personaPrompt;
  const modelTier = options?.replyModelTier ?? "reasoning";
  const useFastModel = modelTier === "fast";
  const googleModel = useFastModel ? GOOGLE_MODEL_BASIC : GOOGLE_MODEL_LATEST;

  try {
    const googleSearchTool = useFastModel
      ? undefined
      : (google.tools.googleSearch({}) as Tool<any, any>);
    const { text, sources, providerMetadata, usage } =
      await generateTextResponse(
        {
          model: google(googleModel),
          maxRetries: 0,
          ...(useFastModel ? { maxOutputTokens: 400 } : {}),
          system: systemPrompt,
          ...(googleSearchTool
            ? { tools: { google_search: googleSearchTool } }
            : {}),
          providerOptions: {
            google: {
              serviceTier: 'flex',
            },
          },
          timeout: 600000, // 10 minutes for Flex tier
          messages,
        },
        options,
      );

    logTokenUsage(route, usage, {
      provider: "google",
      model: googleModel,
      tier: modelTier,
    });
    // access the grounding metadata.
    const metadata = (
      providerMetadata as
        | { google?: { groundingMetadata?: unknown; safetyRatings?: unknown } }
        | undefined
    )?.google;
    const groundingMetadata = metadata?.groundingMetadata;
    const safetyRatings = metadata?.safetyRatings;
    return { text, sources, groundingMetadata, safetyRatings };
  } catch (error) {
    if (!isGoogleTransientFailure(error)) {
      throw error;
    }

    console.warn(
      "⚠️ Google ask model failed, falling back to Grok:",
      redactSecrets(error instanceof Error ? error.message : String(error)),
    );

    const webSearchTool = useFastModel ? undefined : xai.tools.webSearch({});
    const { text, sources, providerMetadata, usage } =
      await generateTextResponse(
        {
          model: xai.responses(GROK_REPLY_MODEL),
          ...(useFastModel ? { maxOutputTokens: 400 } : {}),
          system: systemPrompt,
          providerOptions: {
            xai: {
              reasoningEffort: useFastModel ? "low" : "medium",
            },
          },
          ...(webSearchTool ? { tools: { web_search: webSearchTool } } : {}),
          messages,
        },
        options,
      );

    logTokenUsage(`${route}_grok_fallback`, usage, {
      provider: "xai",
      model: GROK_REPLY_MODEL,
      tier: modelTier,
    });
    return {
      text,
      sources,
      groundingMetadata: undefined,
      safetyRatings: undefined,
    };
  }
}
