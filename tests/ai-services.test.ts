import { beforeEach, describe, expect, it, mock } from 'bun:test';

const calls: Array<Record<string, unknown>> = [];
let generatedText = 'mocked text result';

mock.module('ai', () => ({
  generateText: async (params: Record<string, unknown>) => {
    calls.push(params);
    return {
      text: generatedText,
      sources: [{ sourceType: 'url', url: 'https://example.com' }],
      providerMetadata: {
        google: {
          groundingMetadata: { foo: 'bar' },
          safetyRatings: ['safe'],
        },
      },
    };
  },
}));

mock.module('@ai-sdk/google', () => ({
  google: Object.assign((model: string) => ({ model }), {
    tools: {
      googleSearch: () => 'mock-search-tool',
    },
  }),
}));

import { askHandler } from '../services/ask';
import { detectMessageFallacies } from '../services/fallacy-detector';
import { roastMessageContent } from '../services/roast';
import { summarizeText } from '../services/summarize';
import { verifyMessageContent } from '../services/verify';

describe('AI-backed services', () => {
  beforeEach(() => {
    calls.length = 0;
    generatedText = 'mocked text result';
  });

  it('returns ask handler results with metadata', async () => {
    const result = await askHandler('Question?', ['Context']);

    expect(result.text).toBe('mocked text result');
    expect(result.sources).toEqual([{ sourceType: 'url', url: 'https://example.com' }]);
    expect(result.groundingMetadata).toEqual({ foo: 'bar' });
    expect(result.safetyRatings).toEqual(['safe']);
  });

  it('builds verification prompt with optional context', async () => {
    await verifyMessageContent('Hola', { authorName: 'Ada', chatTitle: 'Grupo' });
    const lastCall = calls.at(-1) as any;
    const messageContent = lastCall.messages?.[0]?.content as string;

    expect(messageContent).toContain('Autor o remitente: Ada');
    expect(messageContent).toContain('Conversación: Grupo');
    expect(messageContent).toContain('Hola');
  });

  it('builds fallacy prompt with context', async () => {
    await detectMessageFallacies('Texto', { authorName: 'Ada' });
    const lastCall = calls.at(-1) as any;
    const messageContent = lastCall.messages?.[0]?.content as string;

    expect(messageContent).toContain('Autor o remitente: Ada');
    expect(messageContent).toContain('Texto');
  });

  it('builds roast prompt with context', async () => {
    await roastMessageContent('Texto', { chatTitle: 'Sala' });
    const lastCall = calls.at(-1) as any;
    const messageContent = lastCall.messages?.[0]?.content as string;

    expect(messageContent).toContain('Conversacion: Sala');
    expect(messageContent).toContain('Texto');
  });

  it('summarizes and enforces length limit', async () => {
    const longInput = 'x'.repeat(200);
    const result = await summarizeText(longInput, 5);

    expect(result).toBe('mock…');
  });

  it('falls back when the model returns empty summary', async () => {
    generatedText = '';
    const longInput = 'abcdefghij';
    const result = await summarizeText(longInput, 5);

    expect(result).toBe('abcd…');
  });
});
