import { Database } from "bun:sqlite";
import { describe, expect, it, mock } from "bun:test";
import { GrammyError } from "grammy";
import {
  enqueueLlmJob,
  setChatPersona,
  setupSchema,
} from "../services/sqlite";

const askCallOptions: Array<{
  responseInstruction?: string;
  replyModelTier?: string;
}> = [];

mock.module("../services/ask", () => ({
  askHandler: async (
    _question: string,
    _messagesContext?: string[],
    options?: {
      onPartialText?: (text: string) => Promise<void> | void;
      responseInstruction?: string;
      replyModelTier?: string;
    },
  ) => {
    askCallOptions.push({
      responseInstruction: options?.responseInstruction,
      replyModelTier: options?.replyModelTier,
    });
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
  it("passes the selected reply strategy to the answer prompt", async () => {
    const db = new Database(":memory:");
    setupSchema(db);
    const sendCalls: string[] = [];
    const bot = {
      api: {
        raw: { sendMessageDraft: async () => true },
        sendMessage: async (_chatId: number, text: string) => {
          sendCalls.push(text);
          return {
            message_id: 88,
            date: 1_700_001_100,
            chat: { id: 123, type: "group" },
            text,
          };
        },
      },
    };

    enqueueLlmJob(db, {
      kind: "ask_group",
      chatId: 123,
      requestMessageId: 87,
      question: "I think that point is mistaken.",
      replyStrategy: "disagreement",
      replyModelTier: "fast",
    });

    const worker = startLlmQueueWorker(bot as any, db, { pollIntervalMs: 1 });
    try {
      await waitFor(() => sendCalls.length > 0);
    } finally {
      worker.stop();
    }

    expect(askCallOptions.at(-1)?.responseInstruction).toContain("Reassess");
    expect(askCallOptions.at(-1)?.replyModelTier).toBe("fast");
  });

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
    setChatPersona(db, 123, "pentecostal", 9);

    const worker = startLlmQueueWorker(bot as any, db, { pollIntervalMs: 1 });
    try {
      await waitFor(() => sendCalls.length > 0);
    } finally {
      worker.stop();
    }

    expect(draftCalls[0]?.message_thread_id).toBe(9);
    expect(draftCalls[0]?.text).toBe(
      "🎭 Persona pentecostal\n\nPartial answer",
    );
    expect(sendCalls[0]?.text).toBe("🎭 Persona pentecostal\n\nFinal answer");
    expect(sendCalls[0]?.options.message_thread_id).toBe(9);
    expect(sendCalls[0]?.options.reply_to_message_id).toBe(76);
  });

  it("skips a job without retry or error reply when the bot was kicked", async () => {
    const db = new Database(":memory:");
    setupSchema(db);
    let sendCount = 0;
    const errors: string[] = [];
    const bot = {
      api: {
        raw: {},
        sendMessage: async () => {
          sendCount += 1;
          throw new GrammyError(
            "Call to 'sendMessage' failed!",
            {
              ok: false,
              error_code: 403,
              description: "Forbidden: bot was kicked from the supergroup chat",
            },
            "sendMessage",
            {},
          );
        },
      },
    };

    const jobId = enqueueLlmJob(db, {
      kind: "ask_group",
      chatId: -100123,
      requestMessageId: 5,
      question: "Question",
    });

    const worker = startLlmQueueWorker(bot as any, db, {
      pollIntervalMs: 1,
      onError: (context) => {
        errors.push(context);
      },
    });
    try {
      await waitFor(
        () =>
          (db.query("SELECT status FROM llm_jobs WHERE id = ?").get(jobId) as {
            status: string;
          }).status === "done",
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      worker.stop();
    }

    expect(sendCount).toBe(1);
    expect(errors).toEqual([]);
    const job = db
      .query("SELECT attempts, last_error FROM llm_jobs WHERE id = ?")
      .get(jobId) as { attempts: number; last_error: string };
    expect(job.attempts).toBe(1);
    expect(job.last_error).toContain("bot was kicked");
  });
});
