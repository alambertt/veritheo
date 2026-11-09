type TelegramMessageEntity = {
  type: string;
  offset: number;
  length: number;
};

type GetGroupMentionAutoAskQuestionParams = {
  chatType?: string;
  text?: string;
  entities?: TelegramMessageEntity[];
  botUsername?: string | string[];
  isBot?: boolean;
  isAnonymousAdmin?: boolean;
  isCommand?: boolean;
  userId?: number;
  bannedUserIds?: number[];
};

function normalizeBotUsernames(botUsername?: string | string[]): string[] {
  return [botUsername ?? []]
    .flat()
    .map((name) => name.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean);
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

  if ((params.isBot && !params.isAnonymousAdmin) || params.isCommand) {
    return undefined;
  }

  if (
    typeof params.userId === "number" &&
    params.bannedUserIds?.includes(params.userId)
  ) {
    return undefined;
  }

  const text = params.text?.trim();
  const botUsernames = normalizeBotUsernames(params.botUsername);
  if (!text || botUsernames.length === 0 || !params.entities?.length) {
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

    return botUsernames.includes(mentionText);
  });

  if (matchedMentionEntities.length === 0) {
    return undefined;
  }

  const question = removeMatchedMentions(text, matchedMentionEntities);
  return question ? question : undefined;
}
