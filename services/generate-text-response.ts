import { generateText, streamText } from "ai";

export interface PartialTextOptions {
  onPartialText?: (text: string) => Promise<void> | void;
}

export interface LoggedTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface GeneratedTextResponse {
  text: string;
  sources: unknown;
  providerMetadata: unknown;
  usage: LoggedTokenUsage | undefined;
}

export async function generateTextResponse(
  request: Parameters<typeof generateText>[0],
  options?: PartialTextOptions,
): Promise<GeneratedTextResponse> {
  if (!options?.onPartialText) {
    const { text, sources, providerMetadata, usage } =
      await generateText(request);
    return { text, sources, providerMetadata, usage };
  }

  const result = streamText(request);
  let streamedText = "";

  for await (const textPart of result.textStream) {
    streamedText += textPart;
    await options.onPartialText(streamedText);
  }

  const [text, sources, providerMetadata, usage] = await Promise.all([
    result.text,
    result.sources,
    result.providerMetadata,
    result.totalUsage,
  ]);

  return { text, sources, providerMetadata, usage };
}
