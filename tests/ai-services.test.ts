import { beforeEach, describe, expect, it, mock } from 'bun:test';

const calls: Array<Record<string, unknown>> = [];
let generatedText = 'mocked text result';
let generateTextImpl: ((params: Record<string, unknown>) => Promise<Record<string, unknown>>) | undefined;

mock.module('ai', () => ({
  generateText: async (params: Record<string, unknown>) => {
    if (generateTextImpl) {
      const result = await generateTextImpl(params);
      calls.push(params);
      return result;
    }

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

mock.module('@ai-sdk/xai', () => ({
  xai: {
    responses: (model: string) => ({ model, provider: 'xai' }),
    tools: {
      webSearch: () => 'mock-web-search-tool',
    },
  },
}));

import { askHandler } from '../services/ask';
import { detectMessageFallacies } from '../services/fallacy-detector';
import { detectUserHeresy } from '../services/heresy';
import { roastMessageContent } from '../services/roast';
import { summarizeText } from '../services/summarize';
import { verifyMessageContent } from '../services/verify';

describe('AI-backed services', () => {
  beforeEach(() => {
    calls.length = 0;
    generatedText = 'mocked text result';
    generateTextImpl = undefined;
  });

  it('returns ask handler results with metadata', async () => {
    const result = await askHandler('Question?', ['Context']);

    expect(result.text).toBe('mocked text result');
    expect(result.sources).toEqual([{ sourceType: 'url', url: 'https://example.com' }]);
    expect(result.groundingMetadata).toEqual({ foo: 'bar' });
    expect(result.safetyRatings).toEqual(['safe']);
  });

  it('falls back to grok when google fails with a transient socket error', async () => {
    let invocation = 0;
    generateTextImpl = async params => {
      invocation += 1;

      if (invocation === 1) {
        throw new Error(
          'AI_APICallError: Cannot connect to API: The socket connection was closed unexpectedly.'
        );
      }

      return {
        text: 'fallback answer',
        sources: [{ sourceType: 'url', url: 'https://fallback.example.com' }],
        providerMetadata: {
          xai: {
            foo: 'bar',
          },
        },
      };
    };

    const result = await askHandler('Question?');

    expect(result.text).toBe('fallback answer');
    expect(result.sources).toEqual([{ sourceType: 'url', url: 'https://fallback.example.com' }]);
    expect(invocation).toBe(2);
    expect(calls).toHaveLength(1);
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

    expect(messageContent).toContain('Conversación: Sala');
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

  describe('detectUserHeresy', () => {
    it('returns the generated text', async () => {
      generatedText = 'Eres un arriano moderno';
      const result = await detectUserHeresy({ messages: ['Mensaje de prueba'] });

      expect(result.text).toBe('Eres un arriano moderno');
    });

    it('includes author name and chat title in the prompt', async () => {
      await detectUserHeresy({
        authorName: 'Carlos',
        chatTitle: 'Teología Geek',
        messages: ['Primera opinión', 'Segunda opinión'],
      });

      const lastCall = calls.at(-1) as any;
      const content = lastCall.messages?.[0]?.content as string;

      expect(content).toContain('Autor o remitente: Carlos');
      expect(content).toContain('Conversación: Teología Geek');
      expect(content).toContain('- Primera opinión');
      expect(content).toContain('- Segunda opinión');
    });

    it('builds the prompt without optional context fields', async () => {
      await detectUserHeresy({ messages: ['Solo un mensaje'] });

      const lastCall = calls.at(-1) as any;
      const content = lastCall.messages?.[0]?.content as string;

      expect(content).not.toContain('Autor o remitente:');
      expect(content).not.toContain('Conversación:');
      expect(content).toContain('- Solo un mensaje');
    });

    it('uses the heresy system prompt', async () => {
      await detectUserHeresy({ messages: ['Texto'] });

      const lastCall = calls.at(-1) as any;
      expect(lastCall.system).toContain('herejía antigua o medieval');
    });

    it('formats multiple messages as a bullet list', async () => {
      const messages = ['Msg A', 'Msg B', 'Msg C'];
      await detectUserHeresy({ messages });

      const lastCall = calls.at(-1) as any;
      const content = lastCall.messages?.[0]?.content as string;

      expect(content).toContain('- Msg A\n- Msg B\n- Msg C');
    });
  });
});
