import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { GOOGLE_MODEL_BASIC } from '../constants';
import { fallacyDetectorPrompt } from '../prompts/fallacy-detector';

export interface FallacyDetectorOptions {
  authorName?: string;
  chatTitle?: string;
}

export async function detectMessageFallacies(message: string, options: FallacyDetectorOptions = {}) {
  const contextLines: string[] = [];
  if (options.authorName) {
    contextLines.push(`Autor o remitente: ${options.authorName}`);
  }
  if (options.chatTitle) {
    contextLines.push(`Conversación: ${options.chatTitle}`);
  }

  const userContent = [
    'Analiza el siguiente mensaje y enfócate únicamente en enumerar y describir falacias lógicas o retóricas.',
    contextLines.length ? contextLines.join('\n') : null,
    '---',
    message,
    '---',
  ]
    .filter(Boolean)
    .join('\n');

  const { text } = await generateText({
    model: google(GOOGLE_MODEL_BASIC),
    system: fallacyDetectorPrompt,
    messages: [{ role: 'user', content: userContent }],
  });

  return { text };
}

