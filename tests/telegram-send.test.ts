import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import { setupSchema } from "../services/sqlite";
import {
  answerTelegramGuestQuery,
  sendTelegramText,
} from "../services/telegram-send";

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

  it("prefers rich markdown messages when supported", async () => {
    const richCalls: Array<Record<string, unknown>> = [];
    const plainCalls: Array<Record<string, unknown>> = [];
    const api = {
      raw: {
        sendRichMessage: async (payload: Record<string, unknown>) => {
          richCalls.push(payload);
          return {
            message_id: 51,
            message_thread_id: 7,
            date: 1_700_001_001,
            chat: { id: payload.chat_id, type: "private" },
            rich_message: payload.rich_message,
          };
        },
      },
      sendMessage: async (
        chatId: number,
        text: string,
        options: Record<string, unknown>,
      ) => {
        plainCalls.push({ chatId, text, options });
        return {
          message_id: 52,
          date: 1_700_001_002,
          chat: { id: chatId, type: "private" },
          text,
        };
      },
    };

    await sendTelegramText(api as any, db, {
      chatId: 123,
      messageThreadId: 7,
      replyToMessageId: 50,
      text: "## Título\n\n- punto",
    });

    expect(richCalls).toHaveLength(1);
    expect(plainCalls).toHaveLength(0);
    expect(richCalls[0]).toMatchObject({
      chat_id: 123,
      message_thread_id: 7,
      rich_message: {
        markdown: "## Título\n\n- punto",
      },
      reply_parameters: {
        message_id: 50,
        allow_sending_without_reply: true,
      },
    });
  });

  it("falls back when rich markdown sending fails", async () => {
    const calls: Array<{
      chatId: number;
      text: string;
      options: Record<string, unknown>;
    }> = [];
    const api = {
      raw: {
        sendRichMessage: async () => {
          throw new Error("rich not available");
        },
      },
      sendMessage: async (
        chatId: number,
        text: string,
        options: Record<string, unknown>,
      ) => {
        calls.push({ chatId, text, options });
        return {
          message_id: 53,
          date: 1_700_001_003,
          chat: { id: chatId, type: "private" },
          text,
        };
      },
    };

    await sendTelegramText(api as any, db, {
      chatId: 123,
      text: "Plain **bold** fallback",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toBe("Plain bold fallback");
    expect(calls[0]?.options.entities).toEqual([
      {
        type: "bold",
        offset: 6,
        length: 4,
      },
    ]);
  });

  it("answers guest queries with an inline article result", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const api = {
      raw: {
        answerGuestQuery: async (payload: Record<string, unknown>) => {
          calls.push(payload);
          return { inline_message_id: "inline-1" };
        },
      },
    };

    await answerTelegramGuestQuery(api, {
      guestQueryId: "guest-1",
      text: "Guest response",
      preferMarkdown: false,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.guest_query_id).toBe("guest-1");
    expect(calls[0]?.result).toMatchObject({
      type: "article",
      id: "veritheo-answer",
      title: "Veritheo",
      input_message_content: {
        message_text: "Guest response",
      },
    });
  });

  it("answers guest queries with rich markdown when enabled", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const api = {
      raw: {
        answerGuestQuery: async (payload: Record<string, unknown>) => {
          calls.push(payload);
          return { inline_message_id: "inline-2" };
        },
      },
    };

    await answerTelegramGuestQuery(api, {
      guestQueryId: "guest-2",
      text: "## Heading\n\n| A | B |\n| - | - |\n| 1 | 2 |",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.result).toMatchObject({
      input_message_content: {
        rich_message: {
          markdown: "## Heading\n\n| A | B |\n| - | - |\n| 1 | 2 |",
        },
      },
    });
  });
});
