import { Database } from 'bun:sqlite';
import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import {
  buildTelegramMessageRecord,
  getHeresyCacheEntry,
  getMessageByChatAndMessageId,
  getMessagesByChat,
  getUserMessagesForHeresy,
  mapToTelegramRawMessage,
  queryMessages,
  setupSchema,
  storeHeresyCacheEntry,
  storeTelegramMessage,
} from '../services/sqlite';

describe('sqlite message storage', () => {
  const db = new Database(':memory:');

  beforeAll(() => {
    setupSchema(db);
  });

  beforeEach(() => {
    db.run('DELETE FROM messages');
    db.run('DELETE FROM heresy_cache');
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
      }),
    );

    storeTelegramMessage(
      db,
      buildTelegramMessageRecord({
        ...base,
        message_id: 2,
        from: { id: 11, is_bot: false, first_name: 'Human' },
        text: 'Hi',
      }),
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
      }),
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
      }),
    );
    storeTelegramMessage(
      db,
      buildTelegramMessageRecord({
        message_id: 2,
        chat: { id: 9, type: 'group' },
        date: 1_700_000_300,
        text: 'Newer',
      }),
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
      }),
    );
    storeTelegramMessage(
      db,
      buildTelegramMessageRecord({
        message_id: 11,
        chat: { id: 11, type: 'group' },
        date: 1_700_000_600,
        text: 'Ignore me',
      }),
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
      }),
    );

    const messages = getMessagesByChat(db, 12);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.message_id).toBe(21);
  });

  describe('getUserMessagesForHeresy', () => {
    it('returns only long non-bot messages from the given user since a date', () => {
      const chatId = 100;
      const userId = 200;
      const sinceDate = 1_700_000_000;
      const longText = 'A'.repeat(150);

      // matching message: right user, long text, after sinceDate
      storeTelegramMessage(
        db,
        buildTelegramMessageRecord({
          message_id: 1,
          chat: { id: chatId, type: 'group' },
          from: { id: userId, is_bot: false, first_name: 'Human' },
          date: sinceDate + 100,
          text: longText,
        }),
      );

      // too short
      storeTelegramMessage(
        db,
        buildTelegramMessageRecord({
          message_id: 2,
          chat: { id: chatId, type: 'group' },
          from: { id: userId, is_bot: false, first_name: 'Human' },
          date: sinceDate + 200,
          text: 'Short',
        }),
      );

      // from a bot
      storeTelegramMessage(
        db,
        buildTelegramMessageRecord({
          message_id: 3,
          chat: { id: chatId, type: 'group' },
          from: { id: userId, is_bot: true, first_name: 'Bot' },
          date: sinceDate + 300,
          text: longText,
        }),
      );

      // before sinceDate
      storeTelegramMessage(
        db,
        buildTelegramMessageRecord({
          message_id: 4,
          chat: { id: chatId, type: 'group' },
          from: { id: userId, is_bot: false, first_name: 'Human' },
          date: sinceDate - 100,
          text: longText,
        }),
      );

      // different user
      storeTelegramMessage(
        db,
        buildTelegramMessageRecord({
          message_id: 5,
          chat: { id: chatId, type: 'group' },
          from: { id: 999, is_bot: false, first_name: 'Other' },
          date: sinceDate + 400,
          text: longText,
        }),
      );

      // different chat
      storeTelegramMessage(
        db,
        buildTelegramMessageRecord({
          message_id: 6,
          chat: { id: 777, type: 'group' },
          from: { id: userId, is_bot: false, first_name: 'Human' },
          date: sinceDate + 500,
          text: longText,
        }),
      );

      const results = getUserMessagesForHeresy(db, chatId, userId, sinceDate);
      expect(results).toHaveLength(1);
      expect(results[0]?.message_id).toBe(1);
    });

    it('respects the limit parameter', () => {
      const chatId = 101;
      const userId = 201;
      const sinceDate = 1_700_000_000;
      const longText = 'B'.repeat(150);

      for (let i = 0; i < 5; i++) {
        storeTelegramMessage(
          db,
          buildTelegramMessageRecord({
            message_id: 100 + i,
            chat: { id: chatId, type: 'group' },
            from: { id: userId, is_bot: false, first_name: 'Human' },
            date: sinceDate + i * 100,
            text: longText,
          }),
        );
      }

      const results = getUserMessagesForHeresy(db, chatId, userId, sinceDate, { limit: 2 });
      expect(results).toHaveLength(2);
    });

    it('respects the minLength parameter', () => {
      const chatId = 102;
      const userId = 202;
      const sinceDate = 1_700_000_000;

      storeTelegramMessage(
        db,
        buildTelegramMessageRecord({
          message_id: 200,
          chat: { id: chatId, type: 'group' },
          from: { id: userId, is_bot: false, first_name: 'Human' },
          date: sinceDate + 100,
          text: 'C'.repeat(50),
        }),
      );

      storeTelegramMessage(
        db,
        buildTelegramMessageRecord({
          message_id: 201,
          chat: { id: chatId, type: 'group' },
          from: { id: userId, is_bot: false, first_name: 'Human' },
          date: sinceDate + 200,
          text: 'D'.repeat(200),
        }),
      );

      const results = getUserMessagesForHeresy(db, chatId, userId, sinceDate, { minLength: 100 });
      expect(results).toHaveLength(1);
      expect(results[0]?.message_id).toBe(201);
    });

    it('returns empty array when no messages match', () => {
      const results = getUserMessagesForHeresy(db, 999, 999, 0);
      expect(results).toHaveLength(0);
    });

    it('excludes messages with null text', () => {
      const chatId = 103;
      const userId = 203;
      const sinceDate = 1_700_000_000;

      storeTelegramMessage(
        db,
        buildTelegramMessageRecord({
          message_id: 300,
          chat: { id: chatId, type: 'group' },
          from: { id: userId, is_bot: false, first_name: 'Human' },
          date: sinceDate + 100,
          text: undefined,
        }),
      );

      const results = getUserMessagesForHeresy(db, chatId, userId, sinceDate);
      expect(results).toHaveLength(0);
    });
  });

  describe('heresy cache', () => {
    it('stores and retrieves a cache entry', () => {
      storeHeresyCacheEntry(db, {
        chat_id: 1,
        user_id: 10,
        created_at: 1_700_000_000,
        response: 'Eres un arriano moderno',
      });

      const entry = getHeresyCacheEntry(db, 1, 10);
      expect(entry).toBeDefined();
      expect(entry?.chat_id).toBe(1);
      expect(entry?.user_id).toBe(10);
      expect(entry?.created_at).toBe(1_700_000_000);
      expect(entry?.response).toBe('Eres un arriano moderno');
    });

    it('returns undefined when no cache entry exists', () => {
      const entry = getHeresyCacheEntry(db, 999, 999);
      expect(entry).toBeUndefined();
    });

    it('returns the most recent entry when multiple exist', () => {
      storeHeresyCacheEntry(db, {
        chat_id: 2,
        user_id: 20,
        created_at: 1_700_000_000,
        response: 'Primera herejía',
      });

      storeHeresyCacheEntry(db, {
        chat_id: 2,
        user_id: 20,
        created_at: 1_700_100_000,
        response: 'Segunda herejía',
      });

      const entry = getHeresyCacheEntry(db, 2, 20);
      expect(entry?.response).toBe('Segunda herejía');
      expect(entry?.created_at).toBe(1_700_100_000);
    });

    it('isolates entries by chat_id and user_id', () => {
      storeHeresyCacheEntry(db, {
        chat_id: 3,
        user_id: 30,
        created_at: 1_700_000_000,
        response: 'Chat 3 User 30',
      });

      storeHeresyCacheEntry(db, {
        chat_id: 3,
        user_id: 31,
        created_at: 1_700_000_000,
        response: 'Chat 3 User 31',
      });

      storeHeresyCacheEntry(db, {
        chat_id: 4,
        user_id: 30,
        created_at: 1_700_000_000,
        response: 'Chat 4 User 30',
      });

      expect(getHeresyCacheEntry(db, 3, 30)?.response).toBe('Chat 3 User 30');
      expect(getHeresyCacheEntry(db, 3, 31)?.response).toBe('Chat 3 User 31');
      expect(getHeresyCacheEntry(db, 4, 30)?.response).toBe('Chat 4 User 30');
      expect(getHeresyCacheEntry(db, 4, 31)).toBeUndefined();
    });
  });
});
