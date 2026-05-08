import type { Database } from "bun:sqlite";
import { GrammyError } from "grammy";
import type { Api, RawApi } from "grammy";
import type { Message, MessageEntity, ParseMode } from "grammy/types";
import { TELEGRAM_CUSTOM_EMOJI_MAP } from "../constants";
import { summarizeText } from "./summarize";
import {
  buildTelegramMessageRecord,
  isChatPaused,
  mapToTelegramRawMessage,
  storeTelegramMessage,
} from "./sqlite";
import { buildTelegramFormattedText } from "./telegram-formatting";

const TELEGRAM_MESSAGE_LIMIT = 4096;

type SendMessageApi = Pick<Api<RawApi>, "sendMessage">;
type GuestQueryApi = {
  raw: {
    answerGuestQuery(payload: {
      guest_query_id: string;
      result: {
        type: "article";
        id: string;
        title: string;
        description?: string;
        input_message_content: {
          message_text: string;
          parse_mode?: ParseMode;
          entities?: MessageEntity[];
        };
      };
    }): Promise<unknown>;
  };
};

async function limitTelegramText(text: string): Promise<string> {
  if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
    return text;
  }

  return summarizeText(text, TELEGRAM_MESSAGE_LIMIT);
}

function describeSendError(error: unknown): string {
  if (error instanceof GrammyError) {
    return error.description;
  }

  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return typeof error === "string" ? error : JSON.stringify(error);
}

export async function sendTelegramText(
  api: SendMessageApi,
  db: Database,
  params: {
    chatId: number;
    messageThreadId?: number;
    text: string;
    replyToMessageId?: number;
    preferMarkdown?: boolean;
    allowSendingWithoutReply?: boolean;
    bypassPause?: boolean;
  },
): Promise<Message.TextMessage | undefined> {
  if (!params.bypassPause && isChatPaused(db, params.chatId)) {
    return undefined;
  }

  const limitedText = await limitTelegramText(params.text);
  const threadOptions =
    typeof params.messageThreadId === "number"
      ? { message_thread_id: params.messageThreadId }
      : {};
  const replyOptions = params.replyToMessageId
    ? {
        ...threadOptions,
        reply_to_message_id: params.replyToMessageId,
        allow_sending_without_reply: params.allowSendingWithoutReply ?? true,
      }
    : threadOptions;
  const formatted = buildTelegramFormattedText(
    limitedText,
    TELEGRAM_CUSTOM_EMOJI_MAP,
  );
  const attempts: Array<{
    text: string;
    sendOptions:
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

  if (params.preferMarkdown !== false) {
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

  let lastError: unknown;

  for (const attempt of attempts) {
    try {
      const sentMessage = await api.sendMessage(
        params.chatId,
        attempt.text,
        attempt.sendOptions,
      );
      const rawMessage = {
        ...mapToTelegramRawMessage(sentMessage),
        ...(params.messageThreadId
          ? { message_thread_id: params.messageThreadId }
          : {}),
        ...(params.replyToMessageId
          ? { reply_to_message_id: params.replyToMessageId }
          : {}),
      };
      storeTelegramMessage(db, buildTelegramMessageRecord(rawMessage));
      return sentMessage;
    } catch (error) {
      lastError = error;

      // Gracefully skip messages to deleted/archived threads
      if (
        error instanceof GrammyError &&
        error.description.includes("message thread not found")
      ) {
        console.warn(
          `Skipping message to chat ${params.chatId}: thread ${params.messageThreadId} not found.`,
        );
        return undefined;
      }

      if (attempt !== attempts.at(-1)) {
        console.warn(
          `Telegram formatted send failed (${describeSendError(error)}). Retrying with a simpler format.`,
        );
        continue;
      }
    }
  }

  throw lastError ?? new Error("Failed to send Telegram message.");
}

export function describeTelegramSendError(error: unknown): string {
  return describeSendError(error);
}

export async function answerTelegramGuestQuery(
  api: GuestQueryApi,
  params: {
    guestQueryId: string;
    text: string;
    preferMarkdown?: boolean;
  },
) {
  const limitedText = await limitTelegramText(params.text);
  const formatted = buildTelegramFormattedText(
    limitedText,
    TELEGRAM_CUSTOM_EMOJI_MAP,
  );
  const inputMessageContent =
    formatted.entities.length > 0
      ? {
          message_text: formatted.text,
          entities: formatted.entities as MessageEntity[],
        }
      : params.preferMarkdown === false
        ? { message_text: limitedText }
        : {
            message_text: limitedText,
            parse_mode: "Markdown" as const,
          };

  return api.raw.answerGuestQuery({
    guest_query_id: params.guestQueryId,
    result: {
      type: "article",
      id: "veritheo-answer",
      title: "Veritheo",
      description: "Answer from Veritheo",
      input_message_content: inputMessageContent,
    },
  });
}
