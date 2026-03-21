import type { Context } from "grammy";
import {
  createTelegramDraftStreamer,
  supportsTelegramDraftStreaming,
} from "./telegram-drafts";
type TelegramChatType = NonNullable<Context["chat"]>["type"];

export function shouldUseLlmDraftStreaming(params: {
  chatId?: number;
  chatType?: TelegramChatType;
}) {
  if (typeof params.chatId !== "number") {
    return false;
  }

  if (!supportsTelegramDraftStreaming(params.chatId)) {
    return false;
  }

  if (params.chatType === undefined) {
    // Queue jobs do not currently persist the Telegram chat type.
    // We still allow drafts here because chat IDs are enough to distinguish
    // real chats from invalid values, and Telegram uses negative IDs for groups.
    return true;
  }

  return (
    params.chatType === "private" ||
    params.chatType === "group" ||
    params.chatType === "supergroup"
  );
}

export function createLlmDraftStreamerForContext(ctx: Context) {
  const chatId = ctx.chat?.id;
  if (
    !shouldUseLlmDraftStreaming({
      chatId,
      chatType: ctx.chat?.type,
    })
  ) {
    return undefined;
  }
  return createTelegramDraftStreamer(ctx.api, { chatId: chatId as number });
}

export function createLlmDraftStreamerForChat(params: {
  api: Context["api"];
  chatId: number;
  chatType?: TelegramChatType;
}) {
  if (
    !shouldUseLlmDraftStreaming({
      chatId: params.chatId,
      chatType: params.chatType,
    })
  ) {
    return undefined;
  }

  return createTelegramDraftStreamer(params.api, {
    chatId: params.chatId,
  });
}
