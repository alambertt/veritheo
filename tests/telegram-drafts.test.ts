import { describe, expect, it } from "bun:test";
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
});
