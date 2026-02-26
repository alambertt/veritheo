import { google } from '@ai-sdk/google';
import { xai } from '@ai-sdk/xai';
import type { Tool } from 'ai';
import { generateText } from 'ai';
import { GOOGLE_MODEL_LATEST, GROK_MODEL } from '../constants';
import { initialPrompt } from '../prompts/initial';
import { logTokenUsage } from './token-usage';

function buildAskMessages(question: string, messagesContext?: string[]) {
  return [
    ...(messagesContext?.map(msg => ({ role: 'user' as const, content: msg })) ?? []),
    { role: 'user' as const, content: question },
  ];
}

function isGoogleTransientFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes('AI_RetryError') ||
    message.includes('high demand') ||
    message.includes('Please try again later') ||
    message.includes('RESOURCE_EXHAUSTED') ||
    message.includes('429')
  );
}

export async function askHandler(question: string, messagesContext?: string[]) {
  const messages = buildAskMessages(question, messagesContext);
  const route = messagesContext?.length ? '/ask_group' : '/ask';

  try {
    const googleSearchTool = google.tools.googleSearch({}) as Tool<any, any>;
    const { text, sources, providerMetadata, usage } = await generateText({
      model: google(GOOGLE_MODEL_LATEST),
      maxRetries: 0,
      system: initialPrompt,
      tools: {
        google_search: googleSearchTool,
      },
      messages,
    });

    logTokenUsage(route, usage);
    console.log('🚀 ~ askHandler ~ providerMetadata:', providerMetadata);
    console.log('🚀 ~ askHandler ~ sources:', sources);
    console.log('🚀 ~ askHandler ~ text:', text);

    // access the grounding metadata.
    const metadata = providerMetadata?.google;
    const groundingMetadata = metadata?.groundingMetadata;
    const safetyRatings = metadata?.safetyRatings;
    return { text, sources, groundingMetadata, safetyRatings };
  } catch (error) {
    if (!isGoogleTransientFailure(error)) {
      throw error;
    }

    console.warn(
      '⚠️ Google ask model failed, falling back to Grok:',
      error instanceof Error ? error.message : error,
    );

    const webSearchTool = xai.tools.webSearch({});
    const { text, sources, providerMetadata, usage } = await generateText({
      model: xai.responses(GROK_MODEL),
      system: initialPrompt,
      tools: {
        web_search: webSearchTool,
      },
      messages,
    });

    logTokenUsage(`${route}_grok_fallback`, usage);
    console.log('🚀 ~ askHandler (grok fallback) ~ providerMetadata:', providerMetadata);
    console.log('🚀 ~ askHandler (grok fallback) ~ sources:', sources);
    console.log('🚀 ~ askHandler (grok fallback) ~ text:', text);

    return { text, sources, groundingMetadata: undefined, safetyRatings: undefined };
  }
}
