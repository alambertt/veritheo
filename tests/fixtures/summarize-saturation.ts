import { Database } from "bun:sqlite";
import { expect, it } from "bun:test";
import { setupSchema } from "../../services/sqlite";
import { sendTelegramText } from "../../services/telegram-send";

const db = new Database(":memory:");
setupSchema(db);

it("still sends an oversized answer when the summarizer model is saturated", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
  let summarizerCalls = 0;
  globalThis.fetch = (async () => {
    summarizerCalls += 1;
    return new Response(
      JSON.stringify({
        error: {
          code: 503,
          message: "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.",
          status: "UNAVAILABLE",
        },
      }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  const sent: string[] = [];
  const api = {
    sendMessage: async (chatId: number, text: string) => {
      sent.push(text);
      return { message_id: 60, date: 1_700_001_010, chat: { id: chatId, type: "private" }, text };
    },
  };

  try {
    await sendTelegramText(api as any, db, {
      chatId: 123,
      text: "palabra ".repeat(700),
      preferMarkdown: false,
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = originalKey;
  }

  expect(summarizerCalls).toBe(1);
  expect(sent).toHaveLength(1);
  expect(sent[0]!.length).toBeLessThanOrEqual(4096);
}, 30_000);
