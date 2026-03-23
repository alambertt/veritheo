type TelegramMessageEntity = {
  type: string;
  offset: number;
  length: number;
};

type GetGroupMentionAutoAskQuestionParams = {
  chatType?: string;
  text?: string;
  entities?: TelegramMessageEntity[];
  botUsername?: string;
  isBot?: boolean;
  isCommand?: boolean;
  userId?: number;
  bannedUserIds?: number[];
};

function normalizeBotUsername(botUsername?: string): string | undefined {
  const normalized = botUsername?.trim().replace(/^@/, "").toLowerCase();
  return normalized ? normalized : undefined;
}

function getMentionEntityText(text: string, entity: TelegramMessageEntity): string {
  return text.slice(entity.offset, entity.offset + entity.length);
}

function removeMatchedMentions(
  text: string,
  matchedEntities: TelegramMessageEntity[],
): string {
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

export function getGroupMentionAutoAskQuestion(
  params: GetGroupMentionAutoAskQuestionParams,
): string | undefined {
  if (params.chatType !== "group" && params.chatType !== "supergroup") {
    return undefined;
  }

  if (params.isBot || params.isCommand) {
    return undefined;
  }

  if (
    typeof params.userId === "number" &&
    params.bannedUserIds?.includes(params.userId)
  ) {
    return undefined;
  }

  const text = params.text?.trim();
  const botUsername = normalizeBotUsername(params.botUsername);
  if (!text || !botUsername || !params.entities?.length) {
    return undefined;
  }

  const matchedMentionEntities = params.entities.filter((entity) => {
    if (entity.type !== "mention") {
      return false;
    }

    const mentionText = getMentionEntityText(text, entity)
      .trim()
      .replace(/^@/, "")
      .toLowerCase();

    return mentionText === botUsername;
  });

  if (matchedMentionEntities.length === 0) {
    return undefined;
  }

  const question = removeMatchedMentions(text, matchedMentionEntities);
  return question ? question : undefined;
}
