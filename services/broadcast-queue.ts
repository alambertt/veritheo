import type { Database } from "bun:sqlite";
import { Bot } from "grammy";
import {
  buildBroadcastCompletionMessage,
} from "./broadcast";
import {
  claimNextBroadcastDelivery,
  claimNextBroadcastJob,
  completeBroadcastJob,
  getBroadcastJobCounts,
  markBroadcastDeliveryDone,
  markBroadcastDeliveryFailed,
  markBroadcastJobFailed,
  requeueStuckBroadcastJobs,
  type BroadcastJob,
} from "./sqlite";
import {
  describeTelegramSendError,
  sendTelegramText,
} from "./telegram-send";

const DEFAULT_DELIVERY_DELAY_MS = 750;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

type BroadcastWorkerOptions = {
  deliveryDelayMs?: number;
  pollIntervalMs?: number;
  onError?: (context: string, error: unknown) => Promise<void> | void;
};

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function processBroadcastJob(
  bot: Bot,
  db: Database,
  job: BroadcastJob,
  options: BroadcastWorkerOptions,
) {
  const deliveryDelayMs = options.deliveryDelayMs ?? DEFAULT_DELIVERY_DELAY_MS;

  while (true) {
    const delivery = claimNextBroadcastDelivery(db, job.id);
    if (!delivery) {
      break;
    }

    try {
      const sentMessage = await sendTelegramText(bot.api, db, {
        chatId: delivery.chat_id,
        text: job.message,
        preferMarkdown: false,
        bypassPause: true,
      });
      markBroadcastDeliveryDone(db, {
        deliveryId: delivery.id,
        sentMessageId: sentMessage?.message_id,
      });
    } catch (error) {
      markBroadcastDeliveryFailed(db, {
        deliveryId: delivery.id,
        error: describeTelegramSendError(error),
      });
    }

    if (deliveryDelayMs > 0) {
      await wait(deliveryDelayMs);
    }
  }

  const summary = completeBroadcastJob(db, job.id);

  await sendTelegramText(bot.api, db, {
    chatId: job.owner_chat_id,
    text: buildBroadcastCompletionMessage({
      totalCount: summary.total_count,
      sentCount: summary.sent_count,
      failedCount: summary.failed_count,
    }),
    preferMarkdown: false,
    bypassPause: true,
  });
}

export function startBroadcastQueueWorker(
  bot: Bot,
  db: Database,
  options: BroadcastWorkerOptions = {},
) {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let ticking = false;
  let stopped = false;

  const recoveredJobs = requeueStuckBroadcastJobs(db);
  if (recoveredJobs > 0) {
    console.warn(`Recovered ${recoveredJobs} stuck broadcast queue rows.`);
  }

  const tick = async () => {
    if (stopped || ticking) {
      return;
    }

    ticking = true;

    try {
      const job = claimNextBroadcastJob(db);
      if (!job) {
        return;
      }

      try {
        await processBroadcastJob(bot, db, job, options);
      } catch (error) {
        markBroadcastJobFailed(db, job.id, describeTelegramSendError(error));
        if (options.onError) {
          await options.onError(
            `Broadcast queue job failed (jobId=${job.id}, ownerChatId=${job.owner_chat_id})`,
            error,
          );
        }

        const counts = getBroadcastJobCounts(db, job.id);
        try {
          await sendTelegramText(bot.api, db, {
            chatId: job.owner_chat_id,
            text: buildBroadcastCompletionMessage({
              totalCount: counts.total_count,
              sentCount: counts.sent_count,
              failedCount: counts.failed_count,
            }),
            preferMarkdown: false,
            bypassPause: true,
          });
        } catch (summaryError) {
          console.error(
            "Failed to send broadcast failure summary:",
            summaryError,
          );
        }
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
