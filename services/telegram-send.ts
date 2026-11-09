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
import { redactSecrets } from "./log-redaction";

const TELEGRAM_MESSAGE_LIMIT = 4096;
const TELEGRAM_RICH_MESSAGE_LIMIT = 32768;

type InputRichMessage = {
  markdown: string;
  skip_entity_detection?: boolean;
};
type RichMessageSendOptions = {
  message_thread_id?: number;
  reply_parameters?: {
    message_id: number;
    allow_sending_without_reply?: boolean;
  };
};
type SendRichMessageRawApi = {
  sendRichMessage(args: {
    chat_id: number;
    rich_message: InputRichMessage;
  } & RichMessageSendOptions): Promise<Message>;
};
type SendMessageApi = Pick<Api<RawApi>, "sendMessage" | "raw">;
type GuestQueryApi = {
  raw: {
    answerGuestQuery(payload: {
      guest_query_id: string;
      result: {
        type: "article";
        id: string;
        title: string;
        description?: string;
        input_message_content:
          | {
              message_text: string;
              parse_mode?: ParseMode;
              entities?: MessageEntity[];
            }
          | {
              rich_message: InputRichMessage;
            };
      };
    }): Promise<unknown>;
  };
};

async function limitTelegramText(
  text: string,
  limit = TELEGRAM_MESSAGE_LIMIT,
  allowAISummarization = true,
): Promise<string> {
  if (text.length <= limit) {
    return text;
  }

  const truncate = () => {
    const notice = "\n\n[Respuesta recortada por el límite de Telegram.]";
    const end = limit - notice.length;
    // Avoid splitting a UTF-16 surrogate pair at the cutoff.
    const cutoff = /[\uD800-\uDBFF]/.test(text[end - 1] ?? "") ? end - 1 : end;
    return text.slice(0, cutoff) + notice;
  };

  if (!allowAISummarization) {
    return truncate();
  }
  try {
    return await summarizeText(text, limit);
  } catch (error) {
    // The answer already exists; a saturated summarizer must not fail (and re-run) the whole job.
    console.warn("⚠️ Summarization failed, truncating instead:", describeSendError(error));
    return truncate();
  }
}

function describeSendError(error: unknown): string {
  let description: string;
  if (error instanceof GrammyError) {
    description = error.description;
  } else if (error instanceof Error) {
    description = `${error.name}: ${error.message}`;
  } else if (typeof error === "string") {
    description = error;
  } else {
    try {
      description = JSON.stringify(error) ?? String(error);
    } catch {
      description = String(error);
    }
  }

  return redactSecrets(description);
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
    retryOnFormattingErrorOnly?: boolean;
    allowAISummarization?: boolean;
  },
): Promise<Message | undefined> {
  if (!params.bypassPause && isChatPaused(db, params.chatId)) {
    return undefined;
  }

  const limitedText = await limitTelegramText(
    params.text, TELEGRAM_MESSAGE_LIMIT, params.allowAISummarization,
  );
  const limitedRichText = await limitTelegramText(
    params.text,
    TELEGRAM_RICH_MESSAGE_LIMIT,
    params.allowAISummarization,
  );
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
  const richReplyOptions = params.replyToMessageId
    ? {
        ...threadOptions,
        reply_parameters: {
          message_id: params.replyToMessageId,
          allow_sending_without_reply: params.allowSendingWithoutReply ?? true,
        },
      }
    : threadOptions;
  const formatted = buildTelegramFormattedText(
    limitedText,
    TELEGRAM_CUSTOM_EMOJI_MAP,
  );
  const richRawApi = api.raw as RawApi & Partial<SendRichMessageRawApi>;
  const attempts: Array<{
    text: string;
    send(): Promise<Message>;
  }> = [];

  if (params.preferMarkdown !== false && richRawApi.sendRichMessage) {
    attempts.push({
      text: limitedRichText,
      send: () =>
        richRawApi.sendRichMessage!({
          chat_id: params.chatId,
          rich_message: {
            markdown: limitedRichText,
          },
          ...richReplyOptions,
        }),
    });
  }

  if (formatted.entities.length > 0) {
    attempts.push({
      text: formatted.text,
      send: () =>
        api.sendMessage(params.chatId, formatted.text, {
          ...replyOptions,
          entities: formatted.entities as MessageEntity[],
        }),
    });
  }

  if (params.preferMarkdown !== false) {
    attempts.push({
      text: limitedText,
      send: () =>
        api.sendMessage(params.chatId, limitedText, {
          ...replyOptions,
          parse_mode: "Markdown",
        }),
    });
  }

  attempts.push({
    text: limitedText,
    send: () => api.sendMessage(params.chatId, limitedText, replyOptions),
  });

  let lastError: unknown;

  for (const attempt of attempts) {
    try {
      const sentMessage = await attempt.send();
      const rawMessage = {
        ...mapToTelegramRawMessage(sentMessage),
        ...(params.messageThreadId
          ? { message_thread_id: params.messageThreadId }
          : {}),
        ...(params.replyToMessageId
          ? { reply_to_message_id: params.replyToMessageId }
          : {}),
        text: attempt.text,
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

      const formattingRejected =
        error instanceof GrammyError &&
        error.error_code === 400 &&
        /can't parse|cannot parse|entity|entities|rich_message|rich message.*(unsupported|not supported)/i.test(error.description);
      // Opt-in commands must not resend after ambiguous delivery or storage errors.
      // A 403 (kicked, blocked) fails the same way in every format.
      if (
        isBotForbiddenError(error) ||
        (params.retryOnFormattingErrorOnly && !formattingRejected)
      ) {
        throw error;
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

/** The bot can no longer write to the chat (kicked, blocked, or not a member). */
export function isBotForbiddenError(error: unknown): boolean {
  return error instanceof GrammyError && error.error_code === 403;
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
  const limitedRichText = await limitTelegramText(
    params.text,
    TELEGRAM_RICH_MESSAGE_LIMIT,
  );
  const formatted = buildTelegramFormattedText(
    limitedText,
    TELEGRAM_CUSTOM_EMOJI_MAP,
  );
  const fallbackInputMessageContent =
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

  const answer = (
    inputMessageContent:
      | typeof fallbackInputMessageContent
      | { rich_message: InputRichMessage },
  ) =>
    api.raw.answerGuestQuery({
      guest_query_id: params.guestQueryId,
      result: {
        type: "article",
        id: "veritheo-answer",
        title: "Veritheo",
        description: "Answer from Veritheo",
        input_message_content: inputMessageContent,
      },
    });

  if (params.preferMarkdown !== false) {
    try {
      return await answer({
        rich_message: {
          markdown: limitedRichText,
        },
      });
    } catch (error) {
      console.warn(
        `Telegram rich guest query answer failed (${describeSendError(error)}). Retrying with a simpler format.`,
      );
    }
  }

  return answer(fallbackInputMessageContent);
}
