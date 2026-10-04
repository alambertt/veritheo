import type { Context } from "grammy";
import type { Database } from "bun:sqlite";
import {
  createLlmDraftStreamerForContext,
} from "./llm-streaming-policy";
import { sendTelegramText } from "./telegram-send";

export async function replyWithLLMMessage(
  ctx: Context,
  db: Database,
  text: string,
  options?: {
    preferMarkdown?: boolean;
    replyToMessageId?: number;
    messageThreadId?: number;
    retryOnFormattingErrorOnly?: boolean;
    allowAISummarization?: boolean;
  },
) {
  if (!ctx.chat?.id) {
    throw new Error("Missing chat id for Telegram reply.");
  }

  const replyToMessageId =
    typeof options?.replyToMessageId === "number"
      ? options.replyToMessageId
      : ctx.message?.message_id;
  return sendTelegramText(ctx.api, db, {
    chatId: ctx.chat.id,
    messageThreadId:
      typeof options?.messageThreadId === "number"
        ? options.messageThreadId
        : ctx.message?.message_thread_id,
    text,
    preferMarkdown: options?.preferMarkdown,
    retryOnFormattingErrorOnly: options?.retryOnFormattingErrorOnly,
    allowAISummarization: options?.allowAISummarization,
    replyToMessageId,
    allowSendingWithoutReply: true,
  });
}

export function createContextDraftStreamer(ctx: Context) {
  return createLlmDraftStreamerForContext(ctx);
}
