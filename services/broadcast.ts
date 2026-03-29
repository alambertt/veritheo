export const BROADCAST_OWNER_USER_ID = 738668189;

export function getBroadcastMessage(text?: string): string | undefined {
  const trimmed = text?.trim() ?? "";
  const firstSpaceIndex = trimmed.indexOf(" ");

  if (firstSpaceIndex === -1) {
    return undefined;
  }

  const message = trimmed.slice(firstSpaceIndex + 1).trim();
  if (message === "") {
    return undefined;
  }

  return message.replace(/\\n/g, "\n");
}

export function isOwnerBroadcastCommandAllowed(params: {
  chatType?: string;
  userId?: number;
}): boolean {
  return (
    params.chatType === "private" &&
    params.userId === BROADCAST_OWNER_USER_ID
  );
}

export function buildBroadcastAcceptedMessage(targetCount: number): string {
  return `📣 Broadcast en cola para ${targetCount} chat(s).`;
}

export function buildBroadcastCompletionMessage(summary: {
  totalCount: number;
  sentCount: number;
  failedCount: number;
}): string {
  return `📣 Broadcast completado. Total: ${summary.totalCount} · Enviados: ${summary.sentCount} · Fallidos: ${summary.failedCount}`;
}
