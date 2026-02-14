import { google } from '@ai-sdk/google';
import type { Tool } from 'ai';
import { generateText } from 'ai';
import { GOOGLE_MODEL_LATEST } from '../constants';
import { initialPrompt } from '../prompts/initial';
import { logTokenUsage } from './token-usage';

export async function askHandler(question: string, messagesContext?: string[]) {
  const googleSearchTool = google.tools.googleSearch({}) as Tool<any, any>;
  const { text, sources, providerMetadata, usage } = await generateText({
    model: google(GOOGLE_MODEL_LATEST),
    system: initialPrompt,
    tools: {
      google_search: googleSearchTool,
    },
    messages: [
      ...(messagesContext?.map(msg => ({ role: 'user' as const, content: msg })) ?? []),
      { role: 'user' as const, content: question },
    ],
  });
  logTokenUsage(messagesContext?.length ? '/ask_group' : '/ask', usage);
  console.log('🚀 ~ askHandler ~ providerMetadata:', providerMetadata);
  console.log('🚀 ~ askHandler ~ sources:', sources);
  console.log('🚀 ~ askHandler ~ text:', text);

  // access the grounding metadata.
  const metadata = providerMetadata?.google;
  const groundingMetadata = metadata?.groundingMetadata;
  const safetyRatings = metadata?.safetyRatings;
  return { text, sources, groundingMetadata, safetyRatings };
}
