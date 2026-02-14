import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { GOOGLE_MODEL_PRO } from '../constants';
import { roastPrompt } from '../prompts/roast';
import { logTokenUsage } from './token-usage';

export interface RoastOptions {
  authorName?: string;
  chatTitle?: string;
}

export async function roastMessageContent(message: string, options: RoastOptions = {}) {
  const contextLines: string[] = [];
  if (options.authorName) {
    contextLines.push(`Autor o remitente: ${options.authorName}`);
  }
  if (options.chatTitle) {
    contextLines.push(`Conversación: ${options.chatTitle}`);
  }

  const userContent = [
    'Rostiza el argumento usando el espectro teológico contrario y sigue las instrucciones del sistema.',
    contextLines.length ? contextLines.join('\n') : null,
    '---',
    message,
    '---',
  ]
    .filter(Boolean)
    .join('\n');

  const { text, usage } = await generateText({
    model: google(GOOGLE_MODEL_PRO),
    system: roastPrompt,
    messages: [{ role: 'user', content: userContent }],
  });
  logTokenUsage('/roast', usage);

  return { text };
}
