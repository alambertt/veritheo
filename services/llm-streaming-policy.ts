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
  return (
    params.chatType === "private" &&
    typeof params.chatId === "number" &&
    supportsTelegramDraftStreaming(params.chatId)
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
