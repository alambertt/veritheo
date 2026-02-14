import { generateText } from 'ai';
// import { zhipu } from 'zhipu-ai-provider';
import { google } from '@ai-sdk/google';
import { GOOGLE_MODEL_LATEST } from '../constants';
import { heresyPrompt } from '../prompts/heresy';

export interface HeresyOptions {
  authorName?: string;
  chatTitle?: string;
  messages: string[];
}

export async function detectUserHeresy(options: HeresyOptions) {
  const contextLines: string[] = [];
  if (options.authorName) {
    contextLines.push(`Autor o remitente: ${options.authorName}`);
  }
  if (options.chatTitle) {
    contextLines.push(`Conversación: ${options.chatTitle}`);
  }

  const messagesBlock = options.messages.map(message => `- ${message}`).join('\n');

  const userContent = [
    'Analiza los mensajes y determina la herejía histórica cuyo espíritu más se alinea con el usuario.',
    'Sigue estrictamente las instrucciones del sistema.',
    contextLines.length ? contextLines.join('\n') : null,
    '---',
    'Mensajes del usuario:',
    messagesBlock,
    '---',
  ]
    .filter(Boolean)
    .join('\n');

  const { text, usage } = await generateText({
    // model: zhipu(ZHIPU_MODEL),
    model: google(GOOGLE_MODEL_LATEST),
    system: heresyPrompt,
    messages: [{ role: 'user', content: userContent }],
  });
  console.log('🧮 /my_heresy token usage:', {
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
  });

  return { text };
}
