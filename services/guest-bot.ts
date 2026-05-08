type TelegramMessageEntity = {
  type: string;
  offset: number;
  length: number;
};

type TelegramGuestMessage = {
  message_id?: unknown;
  guest_query_id?: unknown;
  text?: unknown;
  caption?: unknown;
  entities?: TelegramMessageEntity[];
  caption_entities?: TelegramMessageEntity[];
  from?: {
    id?: unknown;
    username?: unknown;
    first_name?: unknown;
    last_name?: unknown;
    is_bot?: unknown;
  };
  chat?: {
    id?: unknown;
    title?: unknown;
    username?: unknown;
  };
};

export type GuestBotQuestion = {
  question: string;
  messageId?: number;
  from?: {
    id?: number;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  chat?: {
    id?: number;
    title?: string;
    username?: string;
  };
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

function isBotMention(
  text: string,
  entity: TelegramMessageEntity,
  botUsername?: string,
) {
  const normalizedBotUsername = normalizeBotUsername(botUsername);
  if (!normalizedBotUsername || entity.type !== "mention") {
    return false;
  }

  const mentionText = getMentionEntityText(text, entity)
    .trim()
    .replace(/^@/, "")
    .toLowerCase();

  return mentionText === normalizedBotUsername;
}

function isCommandText(text?: string, entities: TelegramMessageEntity[] = []) {
  if (!text) {
    return false;
  }

  return (
    text.trimStart().startsWith("/") ||
    entities.some(
      (entity) => entity.type === "bot_command" && entity.offset === 0,
    )
  );
}

function removeMatchedMentions(
  text: string,
  entities: TelegramMessageEntity[],
  botUsername?: string,
) {
  const matchedEntities = entities.filter((entity) =>
    isBotMention(text, entity, botUsername),
  );

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
  if (isCommandText(text, entities)) {
    return undefined;
  }

  if (
    !text ||
    !entities.some((entity) => isBotMention(text, entity, params.botUsername))
  ) {
    return undefined;
  }

  const question = removeMatchedMentions(text, entities, params.botUsername);
  const metadata = {
    messageId:
      typeof message.message_id === "number" ? message.message_id : undefined,
    from: message.from
      ? {
          id: typeof message.from.id === "number" ? message.from.id : undefined,
          username:
            typeof message.from.username === "string"
              ? message.from.username
              : undefined,
          first_name:
            typeof message.from.first_name === "string"
              ? message.from.first_name
              : undefined,
          last_name:
            typeof message.from.last_name === "string"
              ? message.from.last_name
              : undefined,
        }
      : undefined,
    chat: message.chat
      ? {
          id: typeof message.chat.id === "number" ? message.chat.id : undefined,
          title:
            typeof message.chat.title === "string"
              ? message.chat.title
              : undefined,
          username:
            typeof message.chat.username === "string"
              ? message.chat.username
              : undefined,
        }
      : undefined,
  };

  if (question) {
    return { question, ...metadata };
  }

  return undefined;
}
