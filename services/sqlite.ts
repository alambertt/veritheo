import { Database, Statement } from 'bun:sqlite';
import type { Chat, Message, User } from 'grammy/types';

const DATABASE_NAME = 'veritheo.sqlite';

const CREATE_MESSAGES_TABLE = `
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    chat_id INTEGER NOT NULL,
    chat_type TEXT NOT NULL,
    chat_title TEXT,
    chat_username TEXT,
    from_id INTEGER,
    from_is_bot INTEGER,
    from_first_name TEXT,
    from_last_name TEXT,
    from_username TEXT,
    text TEXT,
    date INTEGER NOT NULL,
    raw JSON
  );
`;

let insertMessageStatement: Statement | undefined;

export function initializeDatabase(readonly = false): Database {
  const db = new Database(DATABASE_NAME, {
    readonly,
    create: true,
  });

  if (!readonly) {
    setupSchema(db);
  }

  return db;
}

export function setupSchema(db: Database) {
  db.run(CREATE_MESSAGES_TABLE);
}

export type TelegramRawMessage = {
  message_id: number;
  date: number;
  chat: {
    id: number;
    type: string;
    title?: string;
    username?: string;
  };
  from?: {
    id: number;
    is_bot?: boolean;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
  text?: string;
  [key: string]: unknown;
};

export interface TelegramMessageRecord {
  message_id: number;
  chat_id: number;
  chat_type: string;
  chat_title?: string;
  chat_username?: string;
  from_id?: number;
  from_is_bot?: boolean;
  from_first_name?: string;
  from_last_name?: string;
  from_username?: string;
  text?: string;
  date: number;
  raw?: unknown;
}

export interface StoredTelegramMessage extends TelegramMessageRecord {
  id: number;
}

function mapChat(chat: Chat): TelegramRawMessage['chat'] {
  return {
    id: chat.id,
    type: chat.type,
    title: 'title' in chat ? chat.title : undefined,
    username: 'username' in chat ? chat.username : undefined,
  };
}

function mapUser(user: User | undefined): TelegramRawMessage['from'] {
  if (!user) {
    return undefined;
  }

  return {
    id: user.id,
    is_bot: user.is_bot,
    first_name: user.first_name,
    last_name: user.last_name,
    username: user.username,
  };
}

export function mapToTelegramRawMessage(message: Message): TelegramRawMessage {
  const text =
    'text' in message && typeof message.text === 'string'
      ? message.text
      : 'caption' in message && typeof message.caption === 'string'
        ? message.caption
        : undefined;

  return {
    message_id: message.message_id,
    date: message.date,
    chat: mapChat(message.chat),
    from: mapUser((message as { from?: User }).from),
    text,
    raw: message,
  };
}

export function buildTelegramMessageRecord(message: TelegramRawMessage): TelegramMessageRecord {
  return {
    message_id: message.message_id,
    chat_id: message.chat.id,
    chat_type: message.chat.type,
    chat_title: message.chat.title,
    chat_username: message.chat.username,
    from_id: message.from?.id,
    from_is_bot: message.from?.is_bot,
    from_first_name: message.from?.first_name,
    from_last_name: message.from?.last_name,
    from_username: message.from?.username,
    text: message.text,
    date: message.date,
    raw: message,
  };
}

export function storeTelegramMessage(db: Database, message: TelegramMessageRecord) {
  if (!insertMessageStatement) {
    insertMessageStatement = db.query(`
      INSERT INTO messages (
        message_id,
        chat_id,
        chat_type,
        chat_title,
        chat_username,
        from_id,
        from_is_bot,
        from_first_name,
        from_last_name,
        from_username,
        text,
        date,
        raw
      ) VALUES (
        $message_id,
        $chat_id,
        $chat_type,
        $chat_title,
        $chat_username,
        $from_id,
        $from_is_bot,
        $from_first_name,
        $from_last_name,
        $from_username,
        $text,
        $date,
        $raw
      )
    `);
  }

  insertMessageStatement.run({
    $message_id: message.message_id,
    $chat_id: message.chat_id,
    $chat_type: message.chat_type,
    $chat_title: message.chat_title ?? null,
    $chat_username: message.chat_username ?? null,
    $from_id: message.from_id ?? null,
    $from_is_bot: message.from_is_bot === undefined ? null : message.from_is_bot ? 1 : 0,
    $from_first_name: message.from_first_name ?? null,
    $from_last_name: message.from_last_name ?? null,
    $from_username: message.from_username ?? null,
    $text: message.text ?? null,
    $date: message.date,
    $raw: message.raw ? JSON.stringify(message.raw) : null,
  });
  console.log(`✅ Message stored: ${message.message_id} in chat ${message.chat_id} from ${message.from_id}`);
}

export interface MessageQueryOptions {
  chatId?: number;
  fromId?: number;
  textLike?: string;
  sinceDate?: number;
  untilDate?: number;
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
}

function mapStoredMessageRow(row: any): StoredTelegramMessage {
  let raw: unknown = null;
  if (typeof row.raw === 'string' && row.raw.length > 0) {
    try {
      raw = JSON.parse(row.raw);
    } catch {
      raw = row.raw;
    }
  }

  return {
    id: row.id,
    message_id: row.message_id,
    chat_id: row.chat_id,
    chat_type: row.chat_type,
    chat_title: row.chat_title ?? undefined,
    chat_username: row.chat_username ?? undefined,
    from_id: row.from_id ?? undefined,
    from_is_bot: row.from_is_bot === null ? undefined : Boolean(row.from_is_bot),
    from_first_name: row.from_first_name ?? undefined,
    from_last_name: row.from_last_name ?? undefined,
    from_username: row.from_username ?? undefined,
    text: row.text ?? undefined,
    date: row.date,
    raw,
  };
}

export function getMessagesByChat(
  db: Database,
  chatId: number,
  options: { limit?: number; offset?: number; order?: 'asc' | 'desc' } = {}
): StoredTelegramMessage[] {
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;
  const order = options.order ?? 'desc';

  const query = db.query(
    `
      SELECT *
      FROM messages
      WHERE chat_id = $chat_id
      ORDER BY date ${order.toUpperCase()}
      LIMIT $limit OFFSET $offset
    `
  );

  const rows = query.all({
    $chat_id: chatId,
    $limit: limit,
    $offset: offset,
  });

  return rows.map(mapStoredMessageRow);
}

export function queryMessages(db: Database, criteria: MessageQueryOptions = {}): StoredTelegramMessage[] {
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (criteria.chatId !== undefined) {
    conditions.push('chat_id = $chat_id');
    params.$chat_id = criteria.chatId;
  }

  if (criteria.fromId !== undefined) {
    conditions.push('from_id = $from_id');
    params.$from_id = criteria.fromId;
  }

  if (criteria.textLike) {
    conditions.push('text LIKE $text_like');
    params.$text_like = `%${criteria.textLike}%`;
  }

  if (criteria.sinceDate !== undefined) {
    conditions.push('date >= $since_date');
    params.$since_date = criteria.sinceDate;
  }

  if (criteria.untilDate !== undefined) {
    conditions.push('date <= $until_date');
    params.$until_date = criteria.untilDate;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = criteria.limit ?? 100;
  const offset = criteria.offset ?? 0;
  const order = (criteria.order ?? 'desc').toUpperCase();

  const query = db.query(
    `
      SELECT *
      FROM messages
      ${whereClause}
      ORDER BY date ${order}
      LIMIT $limit OFFSET $offset
    `
  );

  const rows = query.all({
    ...params,
    $limit: limit,
    $offset: offset,
  });

  return rows.map(mapStoredMessageRow);
}
