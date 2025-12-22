import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { GOOGLE_MODEL_PRO } from '../constants';
import { roastPrompt } from '../prompts/roast';

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
    contextLines.push(`Conversacion: ${options.chatTitle}`);
  }

  const userContent = [
    'Rostiza el argumento usando el espectro teologico contrario y sigue las instrucciones del sistema.',
    contextLines.length ? contextLines.join('\n') : null,
    '---',
    message,
    '---',
  ]
    .filter(Boolean)
    .join('\n');

  const { text } = await generateText({
    model: google(GOOGLE_MODEL_PRO),
    system: roastPrompt,
    messages: [{ role: 'user', content: userContent }],
  });

  return { text };
}
