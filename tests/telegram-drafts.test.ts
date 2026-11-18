import { describe, expect, it } from "bun:test";
import { GrammyError } from "grammy";
import { createTelegramDraftStreamer } from "../services/telegram-drafts";

describe("createTelegramDraftStreamer", () => {
  it("sends drafts with the provided thread id", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const api = {
      raw: {
        sendMessageDraft: async (payload: Record<string, unknown>) => {
          calls.push(payload);
          return true;
        },
      },
    };

    const streamer = createTelegramDraftStreamer(api as any, {
      chatId: 123,
      messageThreadId: 7,
      draftId: 99,
    });

    await streamer.update("Partial response");
    await streamer.finish("Final response");

    expect(calls[0]).toMatchObject({
      chat_id: 123,
      message_thread_id: 7,
      draft_id: 99,
    });
  });

  it("stops sending drafts while Telegram rate limits them", async () => {
    let calls = 0;
    const api = {
      raw: {
        sendMessageDraft: async () => {
          calls += 1;
          throw new GrammyError(
            "Call to 'sendMessageDraft' failed!",
            {
              ok: false,
              error_code: 429,
              description: "Too Many Requests: retry after 10",
              parameters: { retry_after: 10 },
            },
            "sendMessageDraft",
            {},
          );
        },
      },
    };

    const streamer = createTelegramDraftStreamer(api as any, { chatId: 123 });
    await streamer.update("Partial");
    await streamer.finish("Partial response, now complete");

    expect(calls).toBe(1);
  });
});
