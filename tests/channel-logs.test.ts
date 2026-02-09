import { describe, expect, it } from 'bun:test';
import {
  createChannelLogger,
  describeChat,
  describeUser,
  formatChatLabel,
  formatDisplayName,
  formatErrorDetails,
  formatUserLabel,
} from '../services/channel-logs';

describe('channel log formatting helpers', () => {
  it('formats display names from provided parts', () => {
    expect(formatDisplayName(['Ada', 'Lovelace'])).toBe('Ada Lovelace');
    expect(formatDisplayName(['  Ada  ', undefined, '  '])).toBe('Ada');
    expect(formatDisplayName([undefined, '   '])).toBeUndefined();
  });

  it('formats user labels with fallbacks', () => {
    expect(formatUserLabel({ first_name: 'Ada', last_name: 'Lovelace' })).toBe('Ada Lovelace');
    expect(formatUserLabel({ username: 'ada' })).toBe('@ada');
    expect(formatUserLabel({ id: 42 })).toBe('userId=42');
    expect(formatUserLabel(undefined)).toBe('unknown user');
  });

  it('formats chat labels with title, username, or id fallback', () => {
    expect(formatChatLabel({ title: 'Group', username: 'groupchat' })).toBe('Group @groupchat');
    expect(formatChatLabel({ title: 'Group' })).toBe('Group');
    expect(formatChatLabel({ username: 'groupchat' })).toBe('@groupchat');
    expect(formatChatLabel({ id: 7 })).toBe('chatId=7');
    expect(formatChatLabel(undefined)).toBe('chatId=unknown');
  });

  it('formats error details for different error shapes', () => {
    const error = new Error('Boom');
    const message = formatErrorDetails(error);
    expect(message).toContain('Error: Boom');
    expect(formatErrorDetails('plain')).toBe('plain');
    expect(formatErrorDetails({ status: 500 })).toContain('"status": 500');
  });

  it('describes chat and user from a context-like object', () => {
    const ctx = {
      chat: { id: 99, type: 'group', title: 'Test Group', username: 'testgroup' },
      from: { id: 10, first_name: 'Ada', last_name: 'Lovelace', username: 'ada' },
    };

    expect(describeChat(ctx as any)).toBe('Test Group @testgroup');
    expect(describeUser(ctx as any)).toBe('Ada Lovelace');
  });

  it('creates a logger that no-ops without token and channel id', async () => {
    const logger = createChannelLogger();
    await expect(logger.sendChannelLog('hello')).resolves.toBeUndefined();
    await expect(logger.notifyError('context', new Error('Boom'))).resolves.toBeUndefined();
  });

  it('sends channel logs with normalized chat ids', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; body: string }> = [];

    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), body: String(init?.body) });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    try {
      const logger = createChannelLogger('token', '123');
      await logger.sendChannelLog('hello');
      expect(calls).toHaveLength(1);
      const body = JSON.parse(calls[0]!.body);
      expect(body.chat_id).toBe(-100123);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
