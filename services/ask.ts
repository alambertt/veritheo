import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { GOOGLE_MODEL_BASIC } from '../constants';
import { initialPrompt } from '../prompts/initial';

export async function askHandler(question: string, messagesContext?: string[]) {
  const { text, sources, providerMetadata } = await generateText({
    model: google(GOOGLE_MODEL_BASIC),
    system: initialPrompt,
    tools: {
      google_search: google.tools.googleSearch({}),
    },
    messages: [
      ...(messagesContext?.map(msg => ({ role: 'user' as const, content: msg })) ?? []),
      { role: 'user' as const, content: question },
    ],
  });
  console.log('🚀 ~ askHandler ~ providerMetadata:', providerMetadata);
  console.log('🚀 ~ askHandler ~ sources:', sources);
  console.log('🚀 ~ askHandler ~ text:', text);

  // access the grounding metadata.
  const metadata = providerMetadata?.google;
  const groundingMetadata = metadata?.groundingMetadata;
  const safetyRatings = metadata?.safetyRatings;
  return { text, sources, groundingMetadata, safetyRatings };
}
