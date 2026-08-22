import type { Database } from "bun:sqlite";
import { Bot } from "grammy";
import { askHandler } from "./ask";
import { createLlmDraftStreamerForChat } from "./llm-streaming-policy";
import { buildSourcesMessage } from "./sources";
import {
  claimNextLlmJob,
  getChatPersona,
  isChatPaused,
  markLlmJobDone,
  markLlmJobFailed,
  markLlmJobSkipped,
  requeueStuckLlmJobs,
  type LlmJob,
} from "./sqlite";
import { sendTelegramText } from "./telegram-send";
import { verifyMessageContent } from "./verify";
import { buildPersonaResponseText } from "./persona";

const DEFAULT_MAX_CONCURRENT_JOBS = 3;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_POLL_INTERVAL_MS = 500;
const GENERIC_ERROR_MESSAGE =
  "Lo siento, ha ocurrido un error mientras procesaba tu solicitud. Por favor, inténtalo de nuevo más tarde.";

type QueueWorkerOptions = {
  maxConcurrentJobs?: number;
  maxAttempts?: number;
  pollIntervalMs?: number;
  onError?: (context: string, error: unknown) => Promise<void> | void;
  onResponse?: (payload: {
    job: LlmJob;
    text?: string;
    sourcesMessage?: string;
  }) => Promise<void> | void;
};

async function sendAndPersistMessage(
  bot: Bot,
  db: Database,
  params: {
    chatId: number;
    messageThreadId?: number;
    text: string;
    replyToMessageId?: number;
    preferMarkdown?: boolean;
  },
): Promise<boolean> {
  const sentMessage = await sendTelegramText(bot.api, db, params);
  return Boolean(sentMessage);
}

async function processJob(
  bot: Bot,
  db: Database,
  job: LlmJob,
  options: QueueWorkerOptions = {},
): Promise<"done" | "skipped"> {
  if (isChatPaused(db, job.chat_id)) {
    return "skipped";
  }

  if (job.kind === "verify") {
    const authorName = job.context_messages[0]?.trim() || undefined;
    const chatTitle = job.context_messages[1]?.trim() || undefined;
    const { text } = await verifyMessageContent(job.question, {
      authorName,
      chatTitle,
    });

    if (text) {
      const sent = await sendAndPersistMessage(bot, db, {
        chatId: job.chat_id,
        messageThreadId: job.message_thread_id,
        text,
        replyToMessageId: job.request_message_id,
      });
      if (!sent) {
        return "skipped";
      }
    }
    return "done";
  }
  const draftStreamer = createLlmDraftStreamerForChat({
    api: bot.api,
    chatId: job.chat_id,
    messageThreadId: job.message_thread_id,
  });

  let text: string | undefined;
  let sources: unknown;
  const persona = getChatPersona(db, job.chat_id, job.message_thread_id);

  try {
    const response = await askHandler(
      job.question,
      job.context_messages.length > 0 ? job.context_messages : undefined,
      draftStreamer
        ? {
            onPartialText: (partialText) =>
              draftStreamer.update(buildPersonaResponseText(persona, partialText)),
            route: job.kind === "ask_group" ? "/ask_group" : "/ask",
            persona,
          }
        : {
            route: job.kind === "ask_group" ? "/ask_group" : "/ask",
            persona,
          },
    );

    text = response.text
      ? buildPersonaResponseText(persona, response.text)
      : response.text;
    sources = response.sources;

    await draftStreamer?.finish(text);
  } catch (error) {
    draftStreamer?.abort();
    throw error;
  }

  if (text) {
    const sent = await sendAndPersistMessage(bot, db, {
      chatId: job.chat_id,
      messageThreadId: job.message_thread_id,
      text,
      replyToMessageId: job.request_message_id,
    });
    if (!sent) {
      return "skipped";
    }
  }

  const sourcesMessage = buildSourcesMessage(sources);
  if (sourcesMessage) {
    const sent = await sendAndPersistMessage(bot, db, {
      chatId: job.chat_id,
      messageThreadId: job.message_thread_id,
      text: sourcesMessage,
      replyToMessageId: job.request_message_id,
    });
    if (!sent) {
      return "skipped";
    }
  }

  return "done";
}

export function startLlmQueueWorker(
  bot: Bot,
  db: Database,
  options: QueueWorkerOptions = {},
) {
  const maxConcurrentJobs =
    options.maxConcurrentJobs ?? DEFAULT_MAX_CONCURRENT_JOBS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const activeChatIds = new Set<number>();
  let activeJobs = 0;
  let ticking = false;
  let stopped = false;

  const recoveredJobs = requeueStuckLlmJobs(db);
  if (recoveredJobs > 0) {
    console.warn(`Recovered ${recoveredJobs} stuck LLM queue jobs.`);
  }

  const tick = async () => {
    if (stopped || ticking) {
      return;
    }
    ticking = true;

    try {
      while (activeJobs < maxConcurrentJobs) {
        const lockedChatIds = Array.from(activeChatIds);
        const job = claimNextLlmJob(db, lockedChatIds);
        if (!job) {
          break;
        }

        activeJobs += 1;
        activeChatIds.add(job.chat_id);

        void (async () => {
          try {
            const outcome = await processJob(bot, db, job, options);
            if (outcome === "skipped") {
              markLlmJobSkipped(db, job.id, "Skipped because the chat is paused");
            } else {
              markLlmJobDone(db, job.id);
            }
          } catch (error) {
            const details =
              error instanceof Error
                ? `${error.name}: ${error.message}`
                : String(error);
            markLlmJobFailed(db, {
              jobId: job.id,
              error: details,
              maxAttempts,
            });

            if (job.attempts >= maxAttempts) {
              try {
                await sendAndPersistMessage(bot, db, {
                  chatId: job.chat_id,
                  messageThreadId: job.message_thread_id,
                  text: GENERIC_ERROR_MESSAGE,
                  replyToMessageId: job.request_message_id,
                });
              } catch (sendError) {
                console.error(
                  "Failed to send final queue failure message:",
                  sendError,
                );
              }
            }

            if (options.onError) {
              await options.onError(
                `LLM queue job failed (jobId=${job.id}, kind=${job.kind}, chatId=${job.chat_id}, attempts=${job.attempts})`,
                error,
              );
            }
          } finally {
            activeJobs -= 1;
            activeChatIds.delete(job.chat_id);
            queueMicrotask(() => {
              void tick();
            });
          }
        })();
      }
    } finally {
      ticking = false;
    }
  };

  const interval = setInterval(() => {
    void tick();
  }, pollIntervalMs);

  void tick();

  return {
    stop() {
      stopped = true;
      clearInterval(interval);
    },
  };
}
