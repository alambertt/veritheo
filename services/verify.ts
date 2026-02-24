// import { google } from '@ai-sdk/google';
import { xai } from "@ai-sdk/xai";
import { generateText } from 'ai';
import { GROK_MODEL } from '../constants';
import { verifyPrompt } from '../prompts/verify';
import { logTokenUsage } from './token-usage';

const VERIFY_REASONING_EFFORT = 'low' as const;

export interface VerifyMessageOptions {
  authorName?: string;
  chatTitle?: string;
}

export async function verifyMessageContent(message: string, options: VerifyMessageOptions = {}) {
  const webSearchTool = xai.tools.webSearch({});
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

  const { text, usage } = await generateText({
    model: xai.responses(GROK_MODEL),
    system: verifyPrompt,
    tools: {
      web_search: webSearchTool,
    },
    providerOptions: {
      xai: {
        reasoningEffort: VERIFY_REASONING_EFFORT,
      },
    },
    messages: [{ role: 'user', content: userContent }],
  });
  logTokenUsage('/verify', usage);

  return { text };
}
