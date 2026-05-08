type TelegramMessageEntity = {
  type: string;
  offset: number;
  length: number;
};

type TelegramGuestMessage = {
  guest_query_id?: unknown;
  text?: unknown;
  caption?: unknown;
  entities?: TelegramMessageEntity[];
  caption_entities?: TelegramMessageEntity[];
  from?: {
    id?: unknown;
    is_bot?: unknown;
  };
  reply_to_message?: {
    text?: unknown;
    caption?: unknown;
  };
};

export type GuestBotQuestion = {
  question: string;
  contextMessages?: string[];
};

function normalizeBotUsername(botUsername?: string): string | undefined {
  const normalized = botUsername?.trim().replace(/^@/, "").toLowerCase();
  return normalized ? normalized : undefined;
}

function getMessageText(message?: {
  text?: unknown;
  caption?: unknown;
}): string | undefined {
  if (typeof message?.text === "string") {
    return message.text;
  }

  return typeof message?.caption === "string" ? message.caption : undefined;
}

function getMentionEntityText(text: string, entity: TelegramMessageEntity) {
  return text.slice(entity.offset, entity.offset + entity.length);
}

function removeMatchedMentions(
  text: string,
  entities: TelegramMessageEntity[],
  botUsername?: string,
) {
  const normalizedBotUsername = normalizeBotUsername(botUsername);
  if (!normalizedBotUsername || entities.length === 0) {
    return text.trim();
  }

  const matchedEntities = entities.filter((entity) => {
    if (entity.type !== "mention") {
      return false;
    }

    const mentionText = getMentionEntityText(text, entity)
      .trim()
      .replace(/^@/, "")
      .toLowerCase();

    return mentionText === normalizedBotUsername;
  });

  const sorted = [...matchedEntities].sort((a, b) => b.offset - a.offset);
  let nextText = text;
  for (const entity of sorted) {
    nextText =
      nextText.slice(0, entity.offset) +
      nextText.slice(entity.offset + entity.length);
  }

  return nextText
    .replace(/^[\s,.:;!¡\-–—]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function getGuestQueryId(message: unknown): string | undefined {
  const guestMessage = message as TelegramGuestMessage | undefined;
  return typeof guestMessage?.guest_query_id === "string"
    ? guestMessage.guest_query_id
    : undefined;
}

export function getGuestBotQuestion(params: {
  message: unknown;
  botUsername?: string;
  bannedUserIds?: number[];
}): GuestBotQuestion | undefined {
  const message = params.message as TelegramGuestMessage | undefined;
  if (!message || message.from?.is_bot === true) {
    return undefined;
  }

  if (
    typeof message.from?.id === "number" &&
    params.bannedUserIds?.includes(message.from.id)
  ) {
    return undefined;
  }

  const text = getMessageText(message)?.trim();
  const entities = message.entities ?? message.caption_entities ?? [];
  const question = text
    ? removeMatchedMentions(text, entities, params.botUsername)
    : "";
  const replyText = getMessageText(message.reply_to_message)?.trim();
  const contextMessages = replyText ? [replyText] : undefined;

  if (question) {
    return { question, contextMessages };
  }

  if (replyText) {
    return {
      question: "Please respond to the quoted message.",
      contextMessages,
    };
  }

  return undefined;
}
