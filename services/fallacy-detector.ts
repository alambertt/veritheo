import { google } from "@ai-sdk/google";
import { GOOGLE_MODEL_BASIC } from "../constants";
import { fallacyDetectorPrompt } from "../prompts/fallacy-detector";
import {
  generateTextResponse,
  type PartialTextOptions,
} from "./generate-text-response";
import { logTokenUsage } from "./token-usage";

export interface FallacyDetectorOptions {
  authorName?: string;
  chatTitle?: string;
}

export async function detectMessageFallacies(
  message: string,
  options: FallacyDetectorOptions = {},
  streamOptions?: PartialTextOptions,
) {
  const contextLines: string[] = [];
  if (options.authorName) {
    contextLines.push(`Autor o remitente: ${options.authorName}`);
  }
  if (options.chatTitle) {
    contextLines.push(`Conversación: ${options.chatTitle}`);
  }

  const userContent = [
    "Analiza el siguiente mensaje y enfócate únicamente en enumerar y describir falacias lógicas o retóricas.",
    contextLines.length ? contextLines.join("\n") : null,
    "---",
    message,
    "---",
  ]
    .filter(Boolean)
    .join("\n");

  const { text, usage } = await generateTextResponse(
    {
      model: google(GOOGLE_MODEL_BASIC),
      system: fallacyDetectorPrompt,
      providerOptions: { google: { serviceTier: "flex" } },
      timeout: 600000, // 10 minutes for Flex tier
      messages: [{ role: "user", content: userContent }],
    },
    streamOptions,
  );
  logTokenUsage("/fallacy_detector", usage);

  return { text };
}
