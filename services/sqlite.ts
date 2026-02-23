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

const CREATE_HERESY_CACHE_TABLE = `
  CREATE TABLE IF NOT EXISTS heresy_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    response TEXT NOT NULL
  );
`;

const CREATE_HERESY_CACHE_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_heresy_cache_chat_user
    ON heresy_cache (chat_id, user_id, created_at);
`;
const CREATE_LLM_JOBS_TABLE = `
  CREATE TABLE IF NOT EXISTS llm_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    chat_id INTEGER NOT NULL,
    request_message_id INTEGER NOT NULL,
    question TEXT NOT NULL,
    context_messages_json TEXT,
    created_at INTEGER NOT NULL,
    available_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  );
`;

const CREATE_LLM_JOBS_STATUS_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_llm_jobs_status_available_created
    ON llm_jobs (status, available_at, created_at, id);
`;

const CREATE_LLM_JOBS_CHAT_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_llm_jobs_chat_status_created
    ON llm_jobs (chat_id, status, created_at, id);
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
  db.run(CREATE_HERESY_CACHE_TABLE);
  db.run(CREATE_HERESY_CACHE_INDEX);
  db.run(CREATE_LLM_JOBS_TABLE);
  db.run(CREATE_LLM_JOBS_STATUS_INDEX);
  db.run(CREATE_LLM_JOBS_CHAT_INDEX);
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

export interface HeresyCacheEntry {
  id: number;
  chat_id: number;
  user_id: number;
  created_at: number;
  response: string;
}

export type LlmJobKind = 'ask' | 'ask_group' | 'verify';
export type LlmJobStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface LlmJob {
  id: number;
  kind: LlmJobKind;
  status: LlmJobStatus;
  chat_id: number;
  request_message_id: number;
  question: string;
  context_messages: string[];
  created_at: number;
  available_at: number;
  attempts: number;
  last_error?: string;
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
  fromIsBot?: boolean;
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

export function getUserMessagesForHeresy(
  db: Database,
  chatId: number,
  userId: number,
  sinceDate: number,
  options: { limit?: number; minLength?: number } = {}
): StoredTelegramMessage[] {
  const limit = options.limit ?? 50;
  const minLength = options.minLength ?? 100;

  const query = db.query(
    `
      SELECT *
      FROM messages
      WHERE chat_id = $chat_id
        AND from_id = $from_id
        AND date >= $since_date
        AND text IS NOT NULL
        AND LENGTH(text) > $min_length
        AND (from_is_bot IS NULL OR from_is_bot = 0)
      ORDER BY LENGTH(text) DESC
      LIMIT $limit
    `
  );

  const rows = query.all({
    $chat_id: chatId,
    $from_id: userId,
    $since_date: sinceDate,
    $min_length: minLength,
    $limit: limit,
  });

  const mapped = rows.map(mapStoredMessageRow);
  mapped.sort((a, b) => a.date - b.date);
  return mapped;
}

export function getHeresyCacheEntry(
  db: Database,
  chatId: number,
  userId: number
): HeresyCacheEntry | undefined {
  const query = db.query(
    `
      SELECT *
      FROM heresy_cache
      WHERE chat_id = $chat_id AND user_id = $user_id
      ORDER BY created_at DESC
      LIMIT 1
    `
  );

  const row: any = query.get({
    $chat_id: chatId,
    $user_id: userId,
  });

  if (!row) {
    return undefined;
  }

  return {
    id: row.id,
    chat_id: row.chat_id,
    user_id: row.user_id,
    created_at: row.created_at,
    response: row.response,
  };
}

export function storeHeresyCacheEntry(
  db: Database,
  entry: Omit<HeresyCacheEntry, 'id'>
): void {
  const query = db.query(
    `
      INSERT INTO heresy_cache (
        chat_id,
        user_id,
        created_at,
        response
      ) VALUES (
        $chat_id,
        $user_id,
        $created_at,
        $response
      )
    `
  );

  query.run({
    $chat_id: entry.chat_id,
    $user_id: entry.user_id,
    $created_at: entry.created_at,
    $response: entry.response,
  });
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

  if (criteria.fromIsBot !== undefined) {
    conditions.push('from_is_bot = $from_is_bot');
    params.$from_is_bot = criteria.fromIsBot ? 1 : 0;
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

export function getMessageByChatAndMessageId(
  db: Database,
  chatId: number,
  messageId: number
): StoredTelegramMessage | undefined {
  const query = db.query(
    `
      SELECT *
      FROM messages
      WHERE chat_id = $chat_id AND message_id = $message_id
      LIMIT 1
    `
  );

  const row = query.get({
    $chat_id: chatId,
    $message_id: messageId,
  });

  return row ? mapStoredMessageRow(row) : undefined;
}

function mapLlmJobRow(row: any): LlmJob {
  let contextMessages: string[] = [];
  if (typeof row.context_messages_json === 'string' && row.context_messages_json.trim() !== '') {
    try {
      const parsed = JSON.parse(row.context_messages_json);
      if (Array.isArray(parsed)) {
        contextMessages = parsed.filter((message): message is string => typeof message === 'string');
      }
    } catch {
      contextMessages = [];
    }
  }

  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    chat_id: row.chat_id,
    request_message_id: row.request_message_id,
    question: row.question,
    context_messages: contextMessages,
    created_at: row.created_at,
    available_at: row.available_at,
    attempts: row.attempts,
    last_error: row.last_error ?? undefined,
  };
}

export function enqueueLlmJob(
  db: Database,
  params: {
    kind: LlmJobKind;
    chatId: number;
    requestMessageId: number;
    question: string;
    contextMessages?: string[];
    availableAt?: number;
  }
): number {
  const now = Math.floor(Date.now() / 1000);
  const query = db.query(
    `
      INSERT INTO llm_jobs (
        kind,
        status,
        chat_id,
        request_message_id,
        question,
        context_messages_json,
        created_at,
        available_at,
        attempts,
        last_error
      ) VALUES (
        $kind,
        'pending',
        $chat_id,
        $request_message_id,
        $question,
        $context_messages_json,
        $created_at,
        $available_at,
        0,
        NULL
      )
    `
  );

  const result = query.run({
    $kind: params.kind,
    $chat_id: params.chatId,
    $request_message_id: params.requestMessageId,
    $question: params.question,
    $context_messages_json: params.contextMessages ? JSON.stringify(params.contextMessages) : null,
    $created_at: now,
    $available_at: params.availableAt ?? now,
  });

  return Number(result.lastInsertRowid);
}

export function requeueStuckLlmJobs(db: Database): number {
  const now = Math.floor(Date.now() / 1000);
  const query = db.query(
    `
      UPDATE llm_jobs
      SET status = 'pending',
          available_at = $now
      WHERE status = 'processing'
    `
  );
  const result = query.run({ $now: now });
  return result.changes;
}

export function claimNextLlmJob(db: Database, lockedChatIds: number[] = []): LlmJob | undefined {
  const now = Math.floor(Date.now() / 1000);
  const normalizedLockedChatIds = lockedChatIds
    .filter(chatId => Number.isSafeInteger(chatId))
    .map(chatId => Number(chatId));
  const lockFilter =
    normalizedLockedChatIds.length > 0
      ? `AND j.chat_id NOT IN (${normalizedLockedChatIds.join(', ')})`
      : '';

  const query = db.query(
    `
      SELECT j.*
      FROM llm_jobs j
      WHERE j.status = 'pending'
        AND j.available_at <= $now
        ${lockFilter}
        AND NOT EXISTS (
          SELECT 1
          FROM llm_jobs p
          WHERE p.chat_id = j.chat_id
            AND p.status = 'processing'
        )
      ORDER BY j.created_at ASC, j.id ASC
      LIMIT 1
    `
  );

  const candidate: any = query.get({ $now: now });
  if (!candidate) {
    return undefined;
  }

  const claimQuery = db.query(
    `
      UPDATE llm_jobs
      SET status = 'processing',
          attempts = attempts + 1,
          last_error = NULL
      WHERE id = $id
        AND status = 'pending'
    `
  );
  const claimResult = claimQuery.run({ $id: candidate.id });
  if (claimResult.changes === 0) {
    return undefined;
  }

  const claimedRow: any = db
    .query(
      `
        SELECT *
        FROM llm_jobs
        WHERE id = $id
        LIMIT 1
      `
    )
    .get({ $id: candidate.id });

  return claimedRow ? mapLlmJobRow(claimedRow) : undefined;
}

export function markLlmJobDone(db: Database, jobId: number): void {
  db.query(
    `
      UPDATE llm_jobs
      SET status = 'done',
          available_at = CAST(strftime('%s','now') AS INTEGER),
          last_error = NULL
      WHERE id = $id
    `
  ).run({ $id: jobId });
}

export function markLlmJobFailed(
  db: Database,
  params: {
    jobId: number;
    error: string;
    retryInSeconds?: number;
    maxAttempts?: number;
  }
): void {
  const row: any = db
    .query(
      `
        SELECT attempts
        FROM llm_jobs
        WHERE id = $id
        LIMIT 1
      `
    )
    .get({ $id: params.jobId });

  if (!row) {
    return;
  }

  const attempts = Number(row.attempts ?? 0);
  const maxAttempts = params.maxAttempts ?? 3;
  const shouldRetry = attempts < maxAttempts;
  const retryInSeconds = params.retryInSeconds ?? Math.min(60, 2 ** attempts);
  const now = Math.floor(Date.now() / 1000);

  db.query(
    `
      UPDATE llm_jobs
      SET status = $status,
          available_at = $available_at,
          last_error = $last_error
      WHERE id = $id
    `
  ).run({
    $status: shouldRetry ? 'pending' : 'failed',
    $available_at: shouldRetry ? now + retryInSeconds : now,
    $last_error: params.error,
    $id: params.jobId,
  });
}

export function countPendingLlmJobsForChat(db: Database, chatId: number): number {
  const row: any = db
    .query(
      `
        SELECT COUNT(*) AS count
        FROM llm_jobs
        WHERE chat_id = $chat_id
          AND status IN ('pending', 'processing')
      `
    )
    .get({ $chat_id: chatId });

  return Number(row?.count ?? 0);
}
