import { GrammyError, type Context } from "grammy";
import type { MessageEntity, ParseMode } from "grammy/types";
import type { Database } from "bun:sqlite";
import { TELEGRAM_CUSTOM_EMOJI_MAP } from "../constants";
import { summarizeText } from "./summarize";
import {
  buildTelegramMessageRecord,
  mapToTelegramRawMessage,
  storeTelegramMessage,
} from "./sqlite";
import {
  buildTelegramFormattedText,
} from "./telegram-formatting";
import {
  createLlmDraftStreamerForContext,
} from "./llm-streaming-policy";

const TELEGRAM_MESSAGE_LIMIT = 4096;

async function limitTelegramText(text: string): Promise<string> {
  if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
    return text;
  }
  return await summarizeText(text, TELEGRAM_MESSAGE_LIMIT);
}

export async function replyWithLLMMessage(
  ctx: Context,
  db: Database,
  text: string,
  options?: { preferMarkdown?: boolean; replyToMessageId?: number },
) {
  const limitedText = await limitTelegramText(text);
  let lastError: unknown;
  const replyToMessageId =
    typeof options?.replyToMessageId === "number"
      ? options.replyToMessageId
      : ctx.message?.message_id;
  const replyOptions = replyToMessageId
    ? {
        reply_to_message_id: replyToMessageId,
        allow_sending_without_reply: true,
      }
    : {};
  const formatted = buildTelegramFormattedText(
    limitedText,
    TELEGRAM_CUSTOM_EMOJI_MAP,
  );
  const attempts: Array<{
    text: string;
    sendOptions?:
      | ({
          entities?: MessageEntity[];
        } & typeof replyOptions)
      | ({
          parse_mode?: ParseMode;
        } & typeof replyOptions);
  }> = [];

  if (formatted.entities.length > 0) {
    attempts.push({
      text: formatted.text,
      sendOptions: {
        ...replyOptions,
        entities: formatted.entities as MessageEntity[],
      },
    });
  }

  if (options?.preferMarkdown !== false) {
    attempts.push({
      text: limitedText,
      sendOptions: {
        ...replyOptions,
        parse_mode: "Markdown",
      },
    });
  }

  attempts.push({
    text: limitedText,
    sendOptions: replyOptions,
  });

  for (const attempt of attempts) {
    try {
      const replyMessage = await ctx.reply(attempt.text, attempt.sendOptions);
      try {
        const botRawMessage = {
          ...mapToTelegramRawMessage(replyMessage),
          ...(replyToMessageId
            ? { reply_to_message_id: replyToMessageId }
            : {}),
        };
        const botRecord = buildTelegramMessageRecord(botRawMessage);
        storeTelegramMessage(db, botRecord);
      } catch (persistError) {
        console.error("Failed to persist bot reply message:", persistError);
      }
      return replyMessage;
    } catch (error) {
      lastError = error;
      if (attempt !== attempts.at(-1)) {
        const description =
          error instanceof GrammyError
            ? error.description
            : error instanceof Error
              ? error.message
              : typeof error === "string"
                ? error
                : JSON.stringify(error);
        console.warn(
          `Telegram formatted send failed (${description}). Retrying with a simpler format.`,
        );
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error("Failed to send reply.");
}

export function createContextDraftStreamer(ctx: Context) {
  return createLlmDraftStreamerForContext(ctx);
}
