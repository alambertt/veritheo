import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { GOOGLE_MODEL_BASIC } from '../constants';
import { verifyPrompt } from '../prompts/verify';

export interface VerifyMessageOptions {
  authorName?: string;
  chatTitle?: string;
}

export async function verifyMessageContent(message: string, options: VerifyMessageOptions = {}) {
  const contextLines: string[] = [];
  if (options.authorName) {
    contextLines.push(`Autor o remitente: ${options.authorName}`);
  }
  if (options.chatTitle) {
    contextLines.push(`Conversación: ${options.chatTitle}`);
  }

  const userContent = [
    'Analiza el siguiente mensaje a la luz de las instrucciones del sistema.',
    contextLines.length ? contextLines.join('\n') : null,
    '---',
    message,
    '---',
  ]
    .filter(Boolean)
    .join('\n');

  const { text } = await generateText({
    model: google(GOOGLE_MODEL_BASIC),
    system: verifyPrompt,
    messages: [{ role: 'user', content: userContent }],
  });

  return { text };
}
