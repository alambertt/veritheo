import type { Context } from 'grammy';

export type UserLike = {
  id?: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export type ChatLike = {
  id?: number;
  title?: string;
  username?: string;
};

export function formatDisplayName(parts: Array<string | undefined>): string | undefined {
  const filtered = parts
    .map(part => part?.trim())
    .filter((part): part is string => Boolean(part && part.length > 0));
  if (filtered.length === 0) {
    return undefined;
  }
  return filtered.join(' ');
}

export function formatUserLabel(user?: UserLike): string {
  return (
    formatDisplayName([user?.first_name, user?.last_name]) ??
    (user?.username ? `@${user.username}` : undefined) ??
    (user?.id ? `userId=${user.id}` : 'unknown user')
  );
}

export function formatChatLabel(chat?: ChatLike): string {
  if (!chat) {
    return 'chatId=unknown';
  }
  const title = chat.title?.trim();
  const username = chat.username?.trim();
  if (title || username) {
    return [title, username ? `@${username}` : undefined].filter(Boolean).join(' ');
  }
  return `chatId=${chat.id ?? 'unknown'}`;
}

export function formatErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    const stack = error.stack ? `\nStack:\n${error.stack}` : '';
    return `${error.name}: ${error.message}${stack}`;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

const TELEGRAM_API_BASE_URL = 'https://api.telegram.org';

type TelegramErrorResponse = {
  ok: false;
  error_code?: number;
  description?: string;
};

type TelegramSuccessResponse = {
  ok: true;
};

async function postToTelegram(token: string, method: string, payload: Record<string, unknown>) {
  const response = await fetch(`${TELEGRAM_API_BASE_URL}/bot${token}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let body: TelegramErrorResponse | TelegramSuccessResponse | undefined;
    try {
      body = (await response.json()) as TelegramErrorResponse | TelegramSuccessResponse;
    } catch {
      // ignore parse errors
    }
    const description =
      body && 'description' in body && typeof body.description === 'string'
        ? body.description
        : `HTTP ${response.status}`;
    throw new Error(`Telegram API error: ${description}`);
  }
}

function normalizeChatId(raw: string | number): string | number {
  const toNumber = (value: string | number) => {
    if (typeof value === 'number') {
      return value;
    }
    return Number(value);
  };

  if (typeof raw === 'number') {
    return raw <= 0 ? raw : Number(`-100${raw}`);
  }

  const trimmed = raw.trim();
  if (/^-?\d+$/.test(trimmed)) {
    if (trimmed.startsWith('-100')) {
      return toNumber(trimmed);
    }
    if (trimmed.startsWith('-')) {
      return toNumber(trimmed);
    }
    return toNumber(`-100${trimmed}`);
  }

  if (trimmed.startsWith('@')) {
    return trimmed;
  }
  return `@${trimmed}`;
}

export function describeChat(ctx: Context): string {
  if (!ctx.chat) {
    return 'chatId=unknown';
  }
  return formatChatLabel({
    id: ctx.chat.id,
    title: 'title' in ctx.chat ? ctx.chat.title : undefined,
    username: 'username' in ctx.chat ? ctx.chat.username : undefined,
  });
}

export function describeUser(ctx: Context): string {
  return formatUserLabel(
    ctx.from
      ? {
          id: ctx.from.id,
          username: ctx.from.username,
          first_name: ctx.from.first_name,
          last_name: ctx.from.last_name,
        }
      : undefined
  );
}

export function createChannelLogger(botToken?: string, channelId?: string | number) {
  async function sendChannelLog(message: string): Promise<void> {
    if (!botToken || !channelId) {
      return;
    }

    try {
      await postToTelegram(botToken, 'sendMessage', {
        chat_id: normalizeChatId(channelId),
        text: message,
      });
    } catch (logError) {
      console.error('Failed to send log message to channel:', logError);
    }
  }

  async function notifyError(context: string, error: unknown): Promise<void> {
    await sendChannelLog(`❌ ${context}\n${formatErrorDetails(error)}`);
  }

  function logCommandInvocation(ctx: Context, command: string, extraLines?: string[]): void {
    const lines = [
      `📣 ${command} invoked`,
      `Chat: ${describeChat(ctx)}`,
      `User: ${describeUser(ctx)}`,
      `MessageId: ${ctx.message?.message_id ?? 'unknown'}`,
    ];
    if (extraLines?.length) {
      lines.push(...extraLines);
    }
    void sendChannelLog(lines.join('\n'));
  }

  return {
    sendChannelLog,
    notifyError,
    logCommandInvocation,
  };
}
