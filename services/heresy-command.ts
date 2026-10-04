import type { Context } from "grammy";
import type { Database } from "bun:sqlite";
import { formatDisplayName } from "./channel-logs";
import { detectUserHeresy, selectHeresyMessages } from "./heresy";
import { GENERIC_ERROR_MESSAGE, MESSAGES } from "./messages";
import { createContextDraftStreamer, replyWithLLMMessage } from "./reply";
import { startTypingIndicator } from "./typing-indicator";
import {
  getMessageByChatAndMessageId,
  getHeresyCacheEntry,
  getUserMessagesForHeresy,
  storeHeresyCacheEntry,
} from "./sqlite";

const HERESY_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
const HERESY_LOOKBACK_SECONDS = 365 * 24 * 60 * 60;
const HERESY_MIN_LENGTH = 100;
const HERESY_MAX_MESSAGES = 20;

export function isHeresyUnavailableError(error: unknown): boolean {
  const seen = new Set<unknown>();
  function visit(value: unknown): boolean {
    if (!value || typeof value !== "object" || seen.has(value)) return false;
    seen.add(value);
    const details = value as {
      name?: string;
      message?: string;
      statusCode?: number;
      lastError?: unknown;
      cause?: unknown;
    };
    // RetryError keeps the provider failure in lastError, not cause.
    if (details.lastError) return visit(details.lastError);
    if (typeof details.statusCode === "number") {
      return [408, 429, 500, 502, 503, 504].includes(details.statusCode);
    }
    if (details.name === "TimeoutError" || details.name === "AbortError") return true;
    if (/high demand|resource_exhausted|temporarily unavailable/i.test(details.message ?? "")) return true;
    return visit(details.cause);
  }
  return visit(error);
}

export function createHeresyCommandHandler(dependencies: {
  database: Database;
  untouchableUserIds: readonly number[];
  notifyError: (label: string, error: unknown) => Promise<void>;
  logCommandInvocation: (ctx: Context, command: string, details: string[]) => void;
}) {
  const { database, notifyError, logCommandInvocation } = dependencies;
  const UNTOUCHABLE_USER_IDS = dependencies.untouchableUserIds;
  return async (ctx: Context) => {
    let responseAttempted = false;
    const sendResponse = async (text: string, replyToMessageId?: number) => {
      // Delivery may have succeeded even when Telegram's acknowledgment was lost.
      // Never send another reply after delivery or cache/storage fails.
      responseAttempted = true;
      return replyWithLLMMessage(ctx, database, text, {
        replyToMessageId,
        retryOnFormattingErrorOnly: true,
        allowAISummarization: false,
      });
    };
    try {
      const replyToMessage = ctx.message?.reply_to_message;
      const chatId = ctx.chat?.id;
      const chatType = ctx.chat?.type;
      const replyToId = replyToMessage?.message_id;

      logCommandInvocation(ctx, "/my_heresy", [
        `ReplyToMessageId: ${replyToId ?? "none"}`,
      ]);

      if (!chatId || !chatType || chatType === "private") {
        await sendResponse(MESSAGES.heresyGroupOnly);
        return;
      }

      if (!replyToMessage) {
        await sendResponse(MESSAGES.heresyReplyRequired);
        return;
      }

      if (replyToMessage.from?.is_bot) {
        await sendResponse(MESSAGES.heresyBotBlocked);
        return;
      }

      let authorId: number | undefined;
      let authorName: string | undefined;

      try {
        const storedMessage = getMessageByChatAndMessageId(
          database,
          chatId,
          replyToId ?? 0,
        );
        if (storedMessage) {
          authorId = storedMessage.from_id ?? undefined;
          authorName =
            formatDisplayName([
              storedMessage.from_first_name,
              storedMessage.from_last_name,
            ]) ??
            storedMessage.from_username ??
            undefined;
        }
      } catch (dbError) {
        console.error(
          "Failed to retrieve message from database for /my_heresy:",
          dbError,
        );
        await notifyError(
          "Failed to retrieve message from database for /my_heresy command",
          dbError,
        );
      }

      if (!authorId && replyToMessage.from) {
        authorId = replyToMessage.from.id;
        authorName =
          authorName ??
          formatDisplayName([
            replyToMessage.from.first_name,
            replyToMessage.from.last_name,
          ]) ??
          replyToMessage.from.username ??
          undefined;
      }

      if (!authorId) {
        await sendResponse(MESSAGES.heresyUserMissing);
        return;
      }

      if (UNTOUCHABLE_USER_IDS.includes(authorId)) {
        await sendResponse(MESSAGES.heresyUntouchable);
        return;
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      const cached = getHeresyCacheEntry(database, chatId, authorId);
      if (cached && nowSeconds - cached.created_at < HERESY_CACHE_TTL_SECONDS) {
        await sendResponse(cached.response, replyToId);
        return;
      }

      const sinceDate = nowSeconds - HERESY_LOOKBACK_SECONDS;
      const recentMessages = getUserMessagesForHeresy(
        database,
        chatId,
        authorId,
        sinceDate,
        {
          limit: HERESY_MAX_MESSAGES,
          minLength: HERESY_MIN_LENGTH,
        },
      );

      const messageTexts = recentMessages
        .map((message) => message.text?.trim())
        .filter((text): text is string =>
          Boolean(text && text.length > HERESY_MIN_LENGTH),
        );

      if (messageTexts.length === 0) {
        await sendResponse(MESSAGES.heresyInsufficientMaterial);
        return;
      }

      const selectedMessageTexts = await selectHeresyMessages(messageTexts);
      const messagesForHeresy = selectedMessageTexts ?? messageTexts;
      if (messagesForHeresy.length === 0) {
        await sendResponse(MESSAGES.heresyInsufficientMaterial);
        return;
      }

      const stopTyping = startTypingIndicator(ctx);
      const draftStreamer = createContextDraftStreamer(ctx);
      try {
        const { text } = await detectUserHeresy(
          {
            authorName,
            chatTitle: ctx.chat.title,
            messages: messagesForHeresy,
          },
          draftStreamer
            ? {
                onPartialText: (partialText) => draftStreamer.update(partialText),
              }
            : undefined,
        );

        await draftStreamer?.finish(text);

        if (text) {
          const sent = await sendResponse(text, replyToId);
          if (sent) {
            storeHeresyCacheEntry(database, {
              chat_id: chatId,
              user_id: authorId,
              created_at: nowSeconds,
              response: text,
            });
          }
        } else {
          await sendResponse(MESSAGES.modelEmptyResult, replyToId);
        }
      } finally {
        draftStreamer?.abort();
        stopTyping();
      }
    } catch (error) {
      console.error("Failed to process /my_heresy command:", error);
      if (!responseAttempted) {
        try {
          await sendResponse(
            isHeresyUnavailableError(error)
              ? MESSAGES.heresyUnavailable
              : GENERIC_ERROR_MESSAGE,
            ctx.message?.reply_to_message?.message_id,
          );
        } catch (replyError) {
          console.error("Failed to send /my_heresy error message:", replyError);
        }
      }
      // Feedback goes first; diagnostic delivery must not delay or duplicate it.
      try {
        await notifyError(
          `Failed to process /my_heresy command (chatId=${ctx.chat?.id ?? "unknown"})`,
          error,
        );
      } catch (notificationError) {
        console.error("Failed to report /my_heresy error:", notificationError);
      }
    }
  };
}
