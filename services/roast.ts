import { google } from "@ai-sdk/google";
import { GOOGLE_MODEL_BASIC } from "../constants";
import { roastPrompt } from "../prompts/roast";
import {
  generateTextResponse,
  type PartialTextOptions,
} from "./generate-text-response";
import { logTokenUsage } from "./token-usage";

export interface RoastOptions {
  authorName?: string;
  chatTitle?: string;
}

export async function roastMessageContent(
  message: string,
  options: RoastOptions = {},
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
    "Rostiza el argumento usando el espectro teológico contrario y sigue las instrucciones del sistema.",
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
      system: roastPrompt,
      messages: [{ role: "user", content: userContent }],
    },
    streamOptions,
  );
  logTokenUsage("/roast", usage);

  return { text };
}
