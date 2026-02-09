import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { findSimilarBotMessageInChat } from '../services/self-message-guard';
import { setupSchema } from '../services/sqlite';

describe('findSimilarBotMessageInChat', () => {
  const db = new Database(':memory:');

  beforeAll(() => {
    setupSchema(db);
  });

  beforeEach(() => {
    db.run('DELETE FROM messages');
  });

  function insertBotMessage(id: number, text: string, date = 1_700_000_000) {
    db.run(
      `
      INSERT INTO messages (
        message_id,
        chat_id,
        chat_type,
        from_is_bot,
        text,
        date
      ) VALUES (
        $message_id,
        $chat_id,
        $chat_type,
        $from_is_bot,
        $text,
        $date
      )
    `,
      {
        $message_id: id,
        $chat_id: 77,
        $chat_type: 'group',
        $from_is_bot: 1,
        $text: text,
        $date: date,
      }
    );
  }

  it('blocks when a prompt is a substring of a recent bot message', () => {
    insertBotMessage(
      100,
      'This is a long response about theological concepts and spiritual growth.'
    );

    const result = findSimilarBotMessageInChat(
      db,
      77,
      'long response about theological concepts and spiritual growth'
    );

    expect(result.blocked).toBe(true);
    expect(result.similarity).toBe(1);
    expect(result.matchedMessageId).toBe(100);
  });

  it('blocks when containment similarity exceeds threshold', () => {
    insertBotMessage(
      101,
      'We are called to love our neighbors as ourselves and to live with humility daily.'
    );

    const result = findSimilarBotMessageInChat(
      db,
      77,
      'We are called to love our neighbors as ourselves and to live with humility',
      {
        containmentThreshold: 0.6,
        minPromptTokensForContainment: 6,
      }
    );

    expect(result.blocked).toBe(true);
    expect(result.matchedMessageId).toBe(101);
    expect(result.similarity).toBeGreaterThanOrEqual(0.6);
  });

  it('returns unblocked when no similar bot message exists', () => {
    insertBotMessage(102, 'A short unrelated note.');

    const result = findSimilarBotMessageInChat(db, 77, 'Completely different content here.');

    expect(result.blocked).toBe(false);
    expect(result.similarity).toBeLessThan(0.85);
  });

  it('returns unblocked for empty prompts', () => {
    insertBotMessage(103, 'Any message.');

    const result = findSimilarBotMessageInChat(db, 77, '   ');

    expect(result.blocked).toBe(false);
    expect(result.similarity).toBe(0);
  });
});
