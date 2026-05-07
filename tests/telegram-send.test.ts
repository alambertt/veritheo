import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import { setupSchema } from "../services/sqlite";
import { sendTelegramText } from "../services/telegram-send";

describe("sendTelegramText", () => {
  const db = new Database(":memory:");

  beforeEach(() => {
    setupSchema(db);
    db.run("DELETE FROM messages");
  });

  it("sends messages with the provided thread id", async () => {
    const calls: Array<{
      chatId: number;
      text: string;
      options: Record<string, unknown>;
    }> = [];
    const api = {
      sendMessage: async (
        chatId: number,
        text: string,
        options: Record<string, unknown>,
      ) => {
        calls.push({ chatId, text, options });
        return {
          message_id: 50,
          message_thread_id: 7,
          date: 1_700_001_000,
          chat: { id: chatId, type: "private" },
          text,
        };
      },
    };

    await sendTelegramText(api as any, db, {
      chatId: 123,
      messageThreadId: 7,
      replyToMessageId: 49,
      text: "Threaded response",
      preferMarkdown: false,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.options.message_thread_id).toBe(7);
    expect(calls[0]?.options.reply_to_message_id).toBe(49);
  });
});
