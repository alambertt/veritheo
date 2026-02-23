import type { Database } from 'bun:sqlite';
import { Bot } from 'grammy';
import type { ParseMode } from 'grammy/types';
import { askHandler } from './ask';
import { buildSourcesMessage } from './sources';
import { buildTelegramMessageRecord, claimNextLlmJob, mapToTelegramRawMessage, markLlmJobDone, markLlmJobFailed, requeueStuckLlmJobs, storeTelegramMessage, type LlmJob } from './sqlite';
import { verifyMessageContent } from './verify';

const DEFAULT_MAX_CONCURRENT_JOBS = 3;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_POLL_INTERVAL_MS = 500;
const GENERIC_ERROR_MESSAGE =
  'Lo siento, ha ocurrido un error mientras procesaba tu solicitud. Por favor, inténtalo de nuevo más tarde.';

type QueueWorkerOptions = {
  maxConcurrentJobs?: number;
  maxAttempts?: number;
  pollIntervalMs?: number;
  onError?: (context: string, error: unknown) => Promise<void> | void;
};

async function sendAndPersistMessage(
  bot: Bot,
  db: Database,
  params: { chatId: number; text: string; replyToMessageId?: number; preferMarkdown?: boolean }
) {
  const attempts: (ParseMode | undefined)[] =
    params.preferMarkdown === false ? [undefined] : ['Markdown', undefined];

  for (const parseMode of attempts) {
    try {
      const sentMessage = await bot.api.sendMessage(params.chatId, params.text, {
        ...(parseMode ? { parse_mode: parseMode } : {}),
        ...(params.replyToMessageId
          ? {
              reply_to_message_id: params.replyToMessageId,
            }
          : {}),
      });
      const rawMessage = mapToTelegramRawMessage(sentMessage as any);
      const record = buildTelegramMessageRecord(rawMessage);
      storeTelegramMessage(db, record);
      return;
    } catch (error) {
      if (parseMode) {
        const description =
          error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
        console.warn(`Markdown queue send failed (${description}). Retrying without formatting.`);
        continue;
      }
      throw error;
    }
  }
}

async function processJob(bot: Bot, db: Database, job: LlmJob) {
  if (job.kind === 'verify') {
    const authorName = job.context_messages[0]?.trim() || undefined;
    const chatTitle = job.context_messages[1]?.trim() || undefined;
    const { text } = await verifyMessageContent(job.question, {
      authorName,
      chatTitle,
    });

    if (text) {
      await sendAndPersistMessage(bot, db, {
        chatId: job.chat_id,
        text,
        replyToMessageId: job.request_message_id,
      });
    }
    return;
  }

  const { text, sources } = await askHandler(job.question, job.kind === 'ask_group' ? job.context_messages : undefined);

  if (text) {
    await sendAndPersistMessage(bot, db, {
      chatId: job.chat_id,
      text,
      replyToMessageId: job.request_message_id,
    });
  }

  const sourcesMessage = buildSourcesMessage(sources);
  if (sourcesMessage) {
    await sendAndPersistMessage(bot, db, {
      chatId: job.chat_id,
      text: sourcesMessage,
      replyToMessageId: job.request_message_id,
    });
  }
}

export function startLlmQueueWorker(bot: Bot, db: Database, options: QueueWorkerOptions = {}) {
  const maxConcurrentJobs = options.maxConcurrentJobs ?? DEFAULT_MAX_CONCURRENT_JOBS;
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
            await processJob(bot, db, job);
            markLlmJobDone(db, job.id);
          } catch (error) {
            const details = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
            markLlmJobFailed(db, {
              jobId: job.id,
              error: details,
              maxAttempts,
            });

            if (job.attempts >= maxAttempts) {
              try {
                await sendAndPersistMessage(bot, db, {
                  chatId: job.chat_id,
                  text: GENERIC_ERROR_MESSAGE,
                  replyToMessageId: job.request_message_id,
                });
              } catch (sendError) {
                console.error('Failed to send final queue failure message:', sendError);
              }
            }

            if (options.onError) {
              await options.onError(
                `LLM queue job failed (jobId=${job.id}, kind=${job.kind}, chatId=${job.chat_id}, attempts=${job.attempts})`,
                error
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
