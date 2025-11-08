import { GrammyError, type Context } from 'grammy';
import type { ParseMode } from 'grammy/types';
import type { Database } from 'bun:sqlite';
import { summarizeText } from './summarize';
import { buildTelegramMessageRecord, mapToTelegramRawMessage, storeTelegramMessage } from './sqlite';

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
  options?: { preferMarkdown?: boolean; replyToMessageId?: number }
) {
  const limitedText = await limitTelegramText(text);
  const attempts: (ParseMode | undefined)[] = options?.preferMarkdown === false ? [undefined] : ['Markdown', undefined];
  let lastError: unknown;
  const replyToMessageId =
    typeof options?.replyToMessageId === 'number' ? options.replyToMessageId : ctx.message?.message_id;

  for (const parseMode of attempts) {
    try {
      const replyMessage = await ctx.reply(
        limitedText,
        parseMode || replyToMessageId
          ? {
              ...(parseMode ? { parse_mode: parseMode } : {}),
              ...(replyToMessageId
                ? {
                    reply_to_message_id: replyToMessageId,
                    allow_sending_without_reply: true,
                  }
                : {}),
            }
          : undefined
      );
      try {
        const botRawMessage = mapToTelegramRawMessage(replyMessage);
        const botRecord = buildTelegramMessageRecord(botRawMessage);
        storeTelegramMessage(db, botRecord);
      } catch (persistError) {
        console.error('Failed to persist bot reply message:', persistError);
      }
      return replyMessage;
    } catch (error) {
      lastError = error;
      if (parseMode) {
        const description =
          error instanceof GrammyError
            ? error.description
            : error instanceof Error
              ? error.message
              : typeof error === 'string'
                ? error
                : JSON.stringify(error);
        console.warn(`Markdown send failed (${description}). Retrying without formatting.`);
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error('Failed to send reply.');
}
