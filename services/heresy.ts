import { xai } from '@ai-sdk/xai';
import { generateText } from 'ai';
import { GROK_MODEL } from '../constants';
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

  const { text } = await generateText({
    model: xai.responses(GROK_MODEL),
    system: heresyPrompt,
    providerOptions: {
      xai: {
        reasoningEffort: 'medium',
      },
    },
    messages: [{ role: 'user', content: userContent }],
  });

  return { text };
}
