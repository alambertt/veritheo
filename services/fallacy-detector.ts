// import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { zhipu } from 'zhipu-ai-provider';
import { ZHIPU_MODEL } from '../constants';
import { fallacyDetectorPrompt } from '../prompts/fallacy-detector';
import { logTokenUsage } from './token-usage';

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

  const { text, usage } = await generateText({
    // model: google(GOOGLE_MODEL_BASIC),
    model: zhipu(ZHIPU_MODEL),
    system: fallacyDetectorPrompt,
    messages: [{ role: 'user', content: userContent }],
  });
  logTokenUsage('/fallacy_detector', usage);

  return { text };
}

