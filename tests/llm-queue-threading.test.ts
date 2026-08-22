import { Database } from "bun:sqlite";
import { describe, expect, it, mock } from "bun:test";
import {
  enqueueLlmJob,
  setChatPersona,
  setupSchema,
} from "../services/sqlite";

mock.module("../services/ask", () => ({
  askHandler: async (
    _question: string,
    _messagesContext?: string[],
    options?: { onPartialText?: (text: string) => Promise<void> | void },
  ) => {
    await options?.onPartialText?.("Partial answer");
    return {
      text: "Final answer",
      sources: undefined,
      groundingMetadata: undefined,
      safetyRatings: undefined,
    };
  },
}));

const { startLlmQueueWorker } = await import("../services/llm-queue");

async function waitFor(
  assertion: () => boolean,
  timeoutMs = 500,
): Promise<void> {
  const startedAt = Date.now();
  while (!assertion()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for assertion.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("LLM queue threaded replies", () => {
  it("forwards the job thread id to drafts and final replies", async () => {
    const db = new Database(":memory:");
    setupSchema(db);
    const draftCalls: Array<Record<string, unknown>> = [];
    const sendCalls: Array<{
      chatId: number;
      text: string;
      options: Record<string, unknown>;
    }> = [];
    const bot = {
      api: {
        raw: {
          sendMessageDraft: async (payload: Record<string, unknown>) => {
            draftCalls.push(payload);
            return true;
          },
        },
        sendMessage: async (
          chatId: number,
          text: string,
          options: Record<string, unknown>,
        ) => {
          sendCalls.push({ chatId, text, options });
          return {
            message_id: 77,
            message_thread_id: 9,
            date: 1_700_001_100,
            chat: { id: chatId, type: "private" },
            text,
          };
        },
      },
    };

    enqueueLlmJob(db, {
      kind: "ask",
      chatId: 123,
      messageThreadId: 9,
      requestMessageId: 76,
      question: "Question",
    });
    setChatPersona(db, 123, "pentecostal");

    const worker = startLlmQueueWorker(bot as any, db, { pollIntervalMs: 1 });
    try {
      await waitFor(() => sendCalls.length > 0);
    } finally {
      worker.stop();
    }

    expect(draftCalls[0]?.message_thread_id).toBe(9);
    expect(draftCalls[0]?.text).toBe("🎭 Persona pentecostal\nPartial answer");
    expect(sendCalls[0]?.text).toBe("🎭 Persona pentecostal\nFinal answer");
    expect(sendCalls[0]?.options.message_thread_id).toBe(9);
    expect(sendCalls[0]?.options.reply_to_message_id).toBe(76);
  });
});
