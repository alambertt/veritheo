import type { Context } from 'grammy';

const TELEGRAM_TYPING_REFRESH_INTERVAL_MS = 4500;

export function startTypingIndicator(ctx: Context): () => void {
  const chatId = ctx.chat?.id;
  if (!chatId) {
    return () => {};
  }

  let stopped = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const sendTypingAction = () => {
    ctx.api
      .sendChatAction(chatId, 'typing')
      .catch(error => {
        console.error('Failed to send typing action:', error);
      })
      .finally(() => {
        if (!stopped) {
          timeout = setTimeout(sendTypingAction, TELEGRAM_TYPING_REFRESH_INTERVAL_MS);
        }
      });
  };

  sendTypingAction();

  return () => {
    stopped = true;
    if (timeout) {
      clearTimeout(timeout);
      timeout = undefined;
    }
  };
}
