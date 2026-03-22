type GetPrivateChatAutoAskQuestionParams = {
  chatType?: string;
  text?: string;
  isBot?: boolean;
  isCommand?: boolean;
  userId?: number;
  bannedUserIds?: number[];
};

export function getPrivateChatAutoAskQuestion(
  params: GetPrivateChatAutoAskQuestionParams,
): string | undefined {
  if (params.chatType !== "private") {
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

  const question = params.text?.trim();
  return question ? question : undefined;
}
