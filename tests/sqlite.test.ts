import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  buildTelegramMessageRecord,
  getMessageByChatAndMessageId,
  getMessagesByChat,
  mapToTelegramRawMessage,
  queryMessages,
  setupSchema,
  storeTelegramMessage,
} from '../services/sqlite';

describe('sqlite message storage', () => {
  const db = new Database(':memory:');

  beforeAll(() => {
    setupSchema(db);
  });

  beforeEach(() => {
    db.run('DELETE FROM messages');
  });

  it('stores messages and filters by chat and bot flag', () => {
    const base = {
      chat: { id: 42, type: 'group' },
      date: 1_700_000_000,
    };

    storeTelegramMessage(
      db,
      buildTelegramMessageRecord({
        ...base,
        message_id: 1,
        from: { id: 10, is_bot: true, first_name: 'Bot' },
        text: 'Hello there',
      })
    );

    storeTelegramMessage(
      db,
      buildTelegramMessageRecord({
        ...base,
        message_id: 2,
        from: { id: 11, is_bot: false, first_name: 'Human' },
        text: 'Hi',
      })
    );

    const botMessages = queryMessages(db, { chatId: 42, fromIsBot: true });
    expect(botMessages).toHaveLength(1);
    expect(botMessages[0]?.message_id).toBe(1);
  });

  it('fetches messages by chat and message id', () => {
    storeTelegramMessage(
      db,
      buildTelegramMessageRecord({
        message_id: 5,
        chat: { id: 7, type: 'private' },
        date: 1_700_000_100,
        text: 'Saved message',
      })
    );

    const record = getMessageByChatAndMessageId(db, 7, 5);
    expect(record).toBeDefined();
    expect(record?.text).toBe('Saved message');
  });

  it('orders messages when querying', () => {
    storeTelegramMessage(
      db,
      buildTelegramMessageRecord({
        message_id: 1,
        chat: { id: 9, type: 'group' },
        date: 1_700_000_200,
        text: 'Older',
      })
    );
    storeTelegramMessage(
      db,
      buildTelegramMessageRecord({
        message_id: 2,
        chat: { id: 9, type: 'group' },
        date: 1_700_000_300,
        text: 'Newer',
      })
    );

    const messages = queryMessages(db, { chatId: 9, order: 'asc' });
    expect(messages.map(message => message.text)).toEqual(['Older', 'Newer']);
  });

  it('maps Telegram messages including captions', () => {
    const mapped = mapToTelegramRawMessage({
      message_id: 99,
      date: 1_700_000_400,
      chat: { id: 555, type: 'private' },
      caption: 'Photo caption',
    } as any);

    const record = buildTelegramMessageRecord(mapped);
    expect(record.text).toBe('Photo caption');
    expect(record.chat_id).toBe(555);
  });

  it('filters with text and date ranges', () => {
    storeTelegramMessage(
      db,
      buildTelegramMessageRecord({
        message_id: 10,
        chat: { id: 11, type: 'group' },
        date: 1_700_000_500,
        text: 'Find me',
      })
    );
    storeTelegramMessage(
      db,
      buildTelegramMessageRecord({
        message_id: 11,
        chat: { id: 11, type: 'group' },
        date: 1_700_000_600,
        text: 'Ignore me',
      })
    );

    const filtered = queryMessages(db, {
      chatId: 11,
      textLike: 'Find',
      sinceDate: 1_700_000_400,
      untilDate: 1_700_000_550,
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.message_id).toBe(10);
  });

  it('returns messages by chat with pagination defaults', () => {
    storeTelegramMessage(
      db,
      buildTelegramMessageRecord({
        message_id: 21,
        chat: { id: 12, type: 'group' },
        date: 1_700_000_700,
        text: 'First',
      })
    );

    const messages = getMessagesByChat(db, 12);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.message_id).toBe(21);
  });
});
