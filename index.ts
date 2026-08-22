import { config } from "dotenv";
import { Bot, type Context } from "grammy";
import {
  createChannelLogger,
  formatDisplayName,
  formatChatLabel,
  formatUserLabel,
} from "./services/channel-logs";
import { detectUserHeresy } from "./services/heresy";
import {
  buildBroadcastAcceptedMessage,
  getBroadcastMessage,
  isOwnerBroadcastCommandAllowed,
} from "./services/broadcast";
import { startBroadcastQueueWorker } from "./services/broadcast-queue";
import { startLlmQueueWorker } from "./services/llm-queue";
import { askHandler } from "./services/ask";
import {
  BANNED_COMMAND_MESSAGE,
  buildQueueReceivedMessage,
  GENERIC_ERROR_MESSAGE,
  MESSAGES,
} from "./services/messages";
import {
  createContextDraftStreamer,
  replyWithLLMMessage,
} from "./services/reply";
import { roastMessageContent } from "./services/roast";
import {
  formatPauseStatusMessage,
  getCommandArgs,
  getCommandName,
  isGroupChatType,
  parsePauseCommandArgs,
  shouldBlockActivityWhilePaused,
} from "./services/chat-pause";
import { verifyMessageContent } from "./services/verify";
import {
  buildTelegramMessageRecord,
  countPendingLlmJobsForChat,
  enqueueLlmJob,
  enqueueBroadcastJob,
  getChatPauseState,
  getChatPersona,
  getBroadcastTargetChats,
  getReplyChainMessages,
  getMessageByChatAndMessageId,
  getMessagesByChat,
  getHeresyCacheEntry,
  getUserMessagesForHeresy,
  initializeDatabase,
  isChatPaused,
  mapToTelegramRawMessage,
  resumeChatPause,
  setChatPauseState,
  setChatPersona,
  storeHeresyCacheEntry,
  storeTelegramMessage,
} from "./services/sqlite";
import { getPrivateChatAutoAskQuestion } from "./services/private-chat-auto-ask";
import { getGroupMentionAutoAskQuestion } from "./services/group-mention-auto-ask";
import { getGuestBotQuestion, getGuestQueryId } from "./services/guest-bot";
import { findSimilarBotMessageInChat } from "./services/self-message-guard";
import { startTypingIndicator } from "./services/typing-indicator";
import { buildSourcesMessage } from "./services/sources";
import { answerTelegramGuestQuery } from "./services/telegram-send";
import {
  generateTheologyQuizPoll,
  sendTheologyQuizPoll,
} from "./services/theology-poll";
import { SIMILARITY_THRESHOLD } from "./constants";
import { getMessagePlainText } from "./services/rich-message";
import {
  buildPersonaHelpMessage,
  resolvePersona,
} from "./services/persona";

config();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN environment variable is not set");
}

const parseUserIdListEnv = (name: string): number[] => {
  const raw = process.env[name];
  if (!raw || raw.trim() === "") {
    return [];
  }

  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const ids = parts.map((part) => {
    const parsed = Number(part);
    if (!Number.isSafeInteger(parsed)) {
      throw new Error(
        `Invalid ${name} environment variable: "${part}" is not an integer user id`,
      );
    }
    return parsed;
  });

  return Array.from(new Set(ids));
};

const parseUserIdEnv = (name: string): number | undefined => {
  const raw = process.env[name];
  if (!raw || raw.trim() === "") {
    return undefined;
  }
  const parsed = Number(raw.trim());
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(
      `Invalid ${name} environment variable: "${raw}" is not an integer user id`,
    );
  }
  return parsed;
};

const bot = new Bot(token);
const database = initializeDatabase();
const DEFAULT_UNTOUCHABLE_USER_IDS: number[] = [];
const configuredUntouchableUserIds = parseUserIdListEnv("UNTOUCHABLE_USER_IDS");
const UNTOUCHABLE_USER_IDS =
  configuredUntouchableUserIds.length > 0
    ? configuredUntouchableUserIds
    : DEFAULT_UNTOUCHABLE_USER_IDS;
const configuredBannedUserId = parseUserIdEnv("BANNED_USER_ID");
const BANNED_USER_IDS = Array.from(
  new Set([
    ...parseUserIdListEnv("BANNED_USER_IDS"),
    ...(configuredBannedUserId ? [configuredBannedUserId] : []),
  ]),
);
const CHANNEL_LOGS_ID = process.env.CHANNEL_LOGS_ID ?? undefined;

const HERESY_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
const HERESY_LOOKBACK_SECONDS = 365 * 24 * 60 * 60;
const HERESY_MIN_LENGTH = 100;
const HERESY_MAX_MESSAGES = 20;

const { sendChannelLog, notifyError, logCommandInvocation } =
  createChannelLogger(token, CHANNEL_LOGS_ID);

const isGroupPauseControlChat = (chatType?: string) =>
  isGroupChatType(chatType);

const ensureGroupAdmin = async (ctx: Context) => {
  if (!isGroupPauseControlChat(ctx.chat?.type)) {
    await ctx.reply(MESSAGES.pauseGroupOnly);
    return false;
  }

  if (!ctx.chat?.id || !ctx.from?.id) {
    await ctx.reply(GENERIC_ERROR_MESSAGE);
    return false;
  }

  const administrators = await ctx.api.getChatAdministrators(ctx.chat.id);
  const isAdmin = administrators.some(
    (administrator) => administrator.user.id === ctx.from?.id,
  );

  if (!isAdmin) {
    await ctx.reply(MESSAGES.pauseAdminOnly);
    return false;
  }

  return true;
};

const getPauseStatusText = (chatId: number) =>
  formatPauseStatusMessage(getChatPauseState(database, chatId));

const isCommandMessage = (
  text?: string,
  entities?: { type: string; offset: number; length: number }[],
) => {
  if (!text || !entities) {
    return false;
  }
  return entities.some(
    (entity) => entity.type === "bot_command" && entity.offset === 0,
  );
};

const getTelegramMessageText = (message?: {
  text?: unknown;
  caption?: unknown;
  rich_message?: unknown;
}) => getMessagePlainText(message);

const getStoredMessagePlainText = (message?: {
  text?: string;
  raw?: unknown;
}) => {
  if (message?.text?.trim()) {
    return message.text;
  }

  if (!message?.raw || typeof message.raw !== "object") {
    return undefined;
  }

  const raw = message.raw as {
    text?: unknown;
    caption?: unknown;
    rich_message?: unknown;
    raw?: {
      text?: unknown;
      caption?: unknown;
      rich_message?: unknown;
    };
  };

  return (
    getMessagePlainText(raw) ??
    (raw.raw ? getMessagePlainText(raw.raw) : undefined)
  );
};

const getTelegramMessageThreadId = (message?: { message_thread_id?: unknown }) =>
  typeof message?.message_thread_id === "number"
    ? message.message_thread_id
    : undefined;

const getUpdateGuestMessage = (update: unknown) => {
  if (!update || typeof update !== "object") {
    return undefined;
  }

  const guestMessage = (update as { guest_message?: unknown }).guest_message;
  return guestMessage && typeof guestMessage === "object"
    ? guestMessage
    : undefined;
};

const isReplyToThisBot = (
  replyToMessage:
    | { from?: { is_bot?: boolean; username?: string } }
    | undefined,
  botUsername?: string,
) =>
  Boolean(
    botUsername &&
    replyToMessage?.from?.is_bot === true &&
    replyToMessage.from.username === botUsername,
  );

const buildThreadContextEntry = (message: {
  text?: string;
  from_is_bot?: boolean;
  from_first_name?: string;
  from_last_name?: string;
  from_username?: string;
}) => {
  const text = message.text?.trim();
  if (!text) {
    return undefined;
  }

  const authorLabel = message.from_is_bot
    ? "Veritheo"
    : (formatDisplayName([message.from_first_name, message.from_last_name]) ??
      message.from_username ??
      "Usuario");

  return `${authorLabel}: ${text}`;
};

const buildReplyContinuationContext = (
  chainMessages: {
    message_id: number;
    text?: string;
    from_is_bot?: boolean;
    from_first_name?: string;
    from_last_name?: string;
    from_username?: string;
  }[],
  currentMessageId: number,
  fallbackReplyMessage?: {
    text?: string;
    caption?: string;
    from?: {
      is_bot?: boolean;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
  },
) => {
  const history = chainMessages
    .filter((message) => message.message_id !== currentMessageId)
    .map(buildThreadContextEntry)
    .filter((message): message is string => Boolean(message));

  if (history.length > 0 || !fallbackReplyMessage) {
    return history;
  }

  const fallbackText = getTelegramMessageText(fallbackReplyMessage)?.trim();
  if (!fallbackText) {
    return history;
  }

  return [
    `${
      fallbackReplyMessage.from?.is_bot
        ? "Veritheo"
        : (formatDisplayName([
            fallbackReplyMessage.from?.first_name,
            fallbackReplyMessage.from?.last_name,
          ]) ??
          fallbackReplyMessage.from?.username ??
          "Usuario")
    }: ${fallbackText}`,
  ];
};

bot.use(async (ctx, next) => {
  const guestMessage = getUpdateGuestMessage(ctx.update);
  if (!guestMessage) {
    return next();
  }

  const guestQueryId = getGuestQueryId(guestMessage);
  if (!guestQueryId) {
    await notifyError("Received guest message without guest_query_id", {
      updateId: ctx.update.update_id,
    });
    return;
  }

  const guestQuestion = getGuestBotQuestion({
    message: guestMessage,
    botUsername: ctx.me.username,
    bannedUserIds: BANNED_USER_IDS,
  });
  if (!guestQuestion) {
    return;
  }

  void sendChannelLog(
    [
      "📣 guest_ask invoked",
      `Chat: ${formatChatLabel(guestQuestion.chat)}`,
      `User: ${formatUserLabel(guestQuestion.from)}`,
      `MessageId: ${guestQuestion.messageId ?? "unknown"}`,
      `GuestQueryId: ${guestQueryId}`,
      `QuestionLength: ${guestQuestion.question.length}`,
    ].join("\n"),
  );

  try {
    const { text, sources } = await askHandler(
      guestQuestion.question,
      undefined,
      { route: "guest_ask" },
    );
    const sourcesMessage = buildSourcesMessage(sources);
    const responseText = sourcesMessage ? `${text}\n\n${sourcesMessage}` : text;

    await answerTelegramGuestQuery(ctx.api as any, {
      guestQueryId,
      text: responseText || GENERIC_ERROR_MESSAGE,
    });
  } catch (error) {
    console.error("Failed to process guest message:", error);
    await notifyError(
      `Failed to process guest message (updateId=${ctx.update.update_id})`,
      error,
    );
    try {
      await answerTelegramGuestQuery(ctx.api as any, {
        guestQueryId,
        text: GENERIC_ERROR_MESSAGE,
        preferMarkdown: false,
      });
    } catch (replyError) {
      console.error("Failed to answer guest message error:", replyError);
      await notifyError("Failed to answer guest message error", replyError);
    }
  }
});

bot.use(async (ctx, next) => {
  const message = ctx.message;
  if (!message) {
    return next();
  }

  if (message.from?.id && BANNED_USER_IDS.includes(message.from.id)) {
    if (isCommandMessage(message.text, message.entities)) {
      await ctx.reply(BANNED_COMMAND_MESSAGE);
      return;
    }
  }

  const commandName = getCommandName(message.text);
  if (
    shouldBlockActivityWhilePaused({
      chatType: ctx.chat?.type,
      isPaused: Boolean(ctx.chat?.id && isChatPaused(database, ctx.chat.id)),
      commandName,
    }) &&
    ctx.chat?.id
  ) {
    if (commandName) {
      await ctx.reply(getPauseStatusText(ctx.chat.id));
    }
    return;
  }

  await next();
});

bot.command("veritheo_pause", async (ctx) => {
  if (!(await ensureGroupAdmin(ctx))) {
    return;
  }

  const chatId = ctx.chat.id;
  const args = parsePauseCommandArgs(getCommandArgs(ctx.message?.text));
  const pausedUntil =
    typeof args.durationSeconds === "number"
      ? Math.floor(Date.now() / 1000) + args.durationSeconds
      : undefined;

  logCommandInvocation(ctx, "/veritheo_pause", [
    `Duration: ${args.durationSeconds ? `${args.durationSeconds}s` : "indefinite"}`,
    `Reason: ${args.reason ?? "[none provided]"}`,
  ]);

  const previousState = getChatPauseState(database, chatId);
  setChatPauseState(database, {
    chatId,
    pausedByUserId: ctx.from?.id,
    pausedUntil,
    reason: args.reason,
  });

  const prefix = previousState?.is_active ? `${MESSAGES.pauseAlreadyActive} ` : "";
  await ctx.reply(`${prefix}${getPauseStatusText(chatId)}`.trim());
});

bot.command("veritheo_resume", async (ctx) => {
  if (!(await ensureGroupAdmin(ctx))) {
    return;
  }

  logCommandInvocation(ctx, "/veritheo_resume");
  const resumed = resumeChatPause(database, ctx.chat.id);
  await ctx.reply(resumed ? MESSAGES.resumeSuccess : MESSAGES.resumeAlreadyActive);
});

bot.command("veritheo_status", async (ctx) => {
  if (!(await ensureGroupAdmin(ctx))) {
    return;
  }

  logCommandInvocation(ctx, "/veritheo_status");
  await ctx.reply(getPauseStatusText(ctx.chat.id));
});

bot.command("veritheo_broadcast", async (ctx) => {
  const chatType = ctx.chat?.type;
  const userId = ctx.from?.id;

  if (chatType !== "private") {
    await ctx.reply(MESSAGES.broadcastPrivateOnly);
    return;
  }

  if (!isOwnerBroadcastCommandAllowed({ chatType, userId })) {
    await ctx.reply(MESSAGES.broadcastOwnerOnly);
    return;
  }

  const message = getBroadcastMessage(ctx.message?.text);
  if (!message) {
    await ctx.reply(MESSAGES.broadcastMissingMessage);
    return;
  }

  const ownerChatId = ctx.chat?.id;
  if (!ownerChatId || !userId) {
    await ctx.reply(GENERIC_ERROR_MESSAGE);
    return;
  }

  const targets = getBroadcastTargetChats(database);
  const job = enqueueBroadcastJob(database, {
    ownerChatId,
    ownerUserId: userId,
    message,
    targets,
  });

  logCommandInvocation(ctx, "/veritheo_broadcast", [
    `Targets: ${job.total_count}`,
    `Message: ${message}`,
  ]);

  await ctx.reply(buildBroadcastAcceptedMessage(job.total_count));
});

bot.command("start", (ctx) => {
  logCommandInvocation(ctx, "/start");
  ctx.reply(MESSAGES.start);
});

bot.command("ask", async (ctx) => {
  try {
    const question = ctx.message?.text.split(" ").slice(1).join(" ");
    logCommandInvocation(ctx, "/ask", [
      `Question: ${question?.trim() || "[none provided]"}`,
    ]);
    if (!question) {
      await ctx.reply(MESSAGES.askMissingQuestion);
      return;
    }
    const chatId = ctx.chat?.id;
    const requestMessageId = ctx.message?.message_id;
    if (!chatId || !requestMessageId) {
      await ctx.reply(GENERIC_ERROR_MESSAGE);
      return;
    }
    const messageThreadId = getTelegramMessageThreadId(ctx.message);
    const contextMessages =
      ctx.chat?.type === "private"
        ? buildRecentPrivateContextMessages(
            chatId,
            requestMessageId,
            messageThreadId,
          )
        : undefined;

    enqueueLlmJob(database, {
      kind: "ask",
      chatId,
      messageThreadId,
      requestMessageId,
      question: question.trim(),
      contextMessages,
    });
    const pendingJobs = countPendingLlmJobsForChat(
      database,
      chatId,
      ctx.chat?.type === "private" ? messageThreadId ?? null : undefined,
    );
    await replyWithLLMMessage(ctx, database, buildQueueReceivedMessage(pendingJobs), {
      preferMarkdown: false,
      replyToMessageId: requestMessageId,
      messageThreadId,
    });
  } catch (error) {
    console.error("Failed to process /ask command:", error);
    await notifyError(
      `Failed to process /ask command (chatId=${ctx.chat?.id ?? "unknown"})`,
      error,
    );
    try {
      await replyWithLLMMessage(ctx, database, GENERIC_ERROR_MESSAGE);
    } catch (replyError) {
      console.error("Failed to send /ask error message:", replyError);
      await notifyError("Failed to send /ask error message", replyError);
    }
  }
});

const buildRecentGroupContextMessages = (
  chatId: number,
  currentMessageId?: number,
): string[] | undefined => {
  const storedMessages = getMessagesByChat(database, chatId, {
    limit: 10,
    order: "desc",
  });
  const textMessages = storedMessages
    .filter(
      (msg) =>
        msg.text &&
        msg.text.trim() !== "" &&
        msg.message_id !== currentMessageId,
    )
    .map((msg) => msg.text!.trim())
    .reverse();

  return textMessages.length > 0 ? textMessages : undefined;
};

const buildRecentPrivateContextMessages = (
  chatId: number,
  currentMessageId?: number,
  messageThreadId?: number,
): string[] | undefined => {
  const storedMessages = getMessagesByChat(database, chatId, {
    limit: 10,
    order: "desc",
    messageThreadId: messageThreadId ?? null,
  });
  const textMessages = storedMessages
    .filter(
      (msg) =>
        msg.text &&
        msg.text.trim() !== "" &&
        msg.message_id !== currentMessageId,
    )
    .map((msg) => msg.text!.trim())
    .reverse();

  return textMessages.length > 0 ? textMessages : undefined;
};

bot.command("ask_group", async (ctx) => {
  try {
    const question = ctx.message?.text.split(" ").slice(1).join(" ").trim();
    console.log("🚀 ~ question:", question);
    logCommandInvocation(ctx, "/ask_group", [
      `Question: ${question || "[none provided]"}`,
    ]);
    let contextMessages: string[] | undefined;
    const chatId = ctx.chat?.id;

    if (!question) {
      await ctx.reply(MESSAGES.askGroupMissingQuestion);
      return;
    }

    if (chatId) {
      const storedMessages = getMessagesByChat(database, chatId, {
        limit: 10,
        order: "desc",
      });
      const textMessages = storedMessages
        .filter(
          (msg) =>
            msg.text &&
            msg.text.trim() !== "" &&
            msg.message_id !== ctx.message?.message_id,
        )
        .map((msg) => msg.text!.trim())
        .reverse();

      if (textMessages.length > 0) {
        contextMessages = textMessages;
      }
    }

    const requestMessageId = ctx.message?.message_id;
    if (!chatId || !requestMessageId) {
      await ctx.reply(GENERIC_ERROR_MESSAGE);
      return;
    }

    enqueueLlmJob(database, {
      kind: "ask_group",
      chatId,
      requestMessageId,
      question,
      contextMessages,
    });
    const pendingJobs = countPendingLlmJobsForChat(database, chatId);
    await replyWithLLMMessage(ctx, database, buildQueueReceivedMessage(pendingJobs), {
      preferMarkdown: false,
      replyToMessageId: requestMessageId,
    });
  } catch (error) {
    console.error("Failed to process /ask_group command:", error);
    await notifyError(
      `Failed to process /ask_group command (chatId=${ctx.chat?.id ?? "unknown"})`,
      error,
    );
    try {
      await replyWithLLMMessage(ctx, database, GENERIC_ERROR_MESSAGE);
    } catch (replyError) {
      console.error("Failed to send /ask_group error message:", replyError);
      await notifyError("Failed to send /ask_group error message", replyError);
    }
  }
});

bot.command("theology_poll", async (ctx) => {
  try {
    if (!isGroupChatType(ctx.chat?.type)) {
      await ctx.reply(MESSAGES.theologyPollGroupOnly);
      return;
    }

    if (!(await ensureGroupAdmin(ctx))) {
      return;
    }

    const prompt = getCommandArgs(ctx.message?.text);
    logCommandInvocation(ctx, "/theology_poll", [
      `Prompt: ${prompt || "[random topic]"}`,
    ]);

    const stopTyping = startTypingIndicator(ctx);
    try {
      const poll = await generateTheologyQuizPoll(prompt);
      const messageThreadId = getTelegramMessageThreadId(ctx.message);
      await sendTheologyQuizPoll(ctx.api, {
        chatId: ctx.chat.id,
        messageThreadId,
        poll,
      });
    } finally {
      stopTyping();
    }
  } catch (error) {
    console.error("Failed to process /theology_poll command:", error);
    await notifyError(
      `Failed to process /theology_poll command (chatId=${ctx.chat?.id ?? "unknown"})`,
      error,
    );
    try {
      await ctx.reply(MESSAGES.theologyPollFailed);
    } catch (replyError) {
      console.error("Failed to send /theology_poll error message:", replyError);
      await notifyError("Failed to send /theology_poll error message", replyError);
    }
  }
});

bot.command("help", (ctx) => {
  logCommandInvocation(ctx, "/help");
  ctx.reply(MESSAGES.help);
});

bot.command("persona", (ctx) => {
  if (ctx.chat?.type !== "private") {
    return ctx.reply(MESSAGES.personaPrivateOnly);
  }

  const args = getCommandArgs(ctx.message?.text);
  const messageThreadId = getTelegramMessageThreadId(ctx.message);
  if (!args || args.toLocaleLowerCase("es").trim() === "help") {
    return ctx.reply(
      buildPersonaHelpMessage(
        getChatPersona(database, ctx.chat.id, messageThreadId),
      ),
    );
  }

  const normalizedArgs = args.toLocaleLowerCase("es").trim();
  const persona = resolvePersona(normalizedArgs === "reset" ? "neutral" : args);
  if (!persona) {
    return ctx.reply(
      buildPersonaHelpMessage(
        getChatPersona(database, ctx.chat.id, messageThreadId),
      ),
    );
  }

  setChatPersona(database, ctx.chat.id, persona.slug, messageThreadId);
  return ctx.reply(MESSAGES.personaChanged(persona.label));
});

bot.command("verify", async (ctx) => {
  try {
    logCommandInvocation(ctx, "/verify", [
      `ReplyToMessageId: ${ctx.message?.reply_to_message?.message_id ?? "none"}`,
    ]);
    if (!ctx.message?.reply_to_message || !ctx.chat?.id) {
      await ctx.reply(MESSAGES.verifyReplyRequired);
      return;
    }

    const replyToId = ctx.message.reply_to_message.message_id;
    const chatId = ctx.chat.id;
    let messageToVerify: string | undefined;
    let authorName: string | undefined;
    const authorId = ctx.message.reply_to_message.from?.id;

    if (authorId && UNTOUCHABLE_USER_IDS.includes(authorId)) {
      await ctx.reply(MESSAGES.verifyUntouchable);
      return;
    }

    try {
      const storedMessage = getMessageByChatAndMessageId(
        database,
        chatId,
        replyToId,
      );
      const storedText = getStoredMessagePlainText(storedMessage)?.trim();
      if (storedText) {
        messageToVerify = storedText;
        authorName =
          formatDisplayName([
            storedMessage?.from_first_name,
            storedMessage?.from_last_name,
          ]) ?? storedMessage?.from_username;
      }
    } catch (dbError) {
      console.error("Failed to retrieve message from database:", dbError);
      await notifyError(
        "Failed to retrieve message from database for /verify command",
        dbError,
      );
    }

    if (!messageToVerify) {
      const replied = ctx.message.reply_to_message;
      // Fallback al payload original entregado por la API de Telegram cuando la BD no tiene el mensaje.
      const repliedText = getTelegramMessageText(replied)?.trim();
      if (repliedText) {
        messageToVerify = repliedText;
      }
      if (!authorName && "from" in replied && replied.from) {
        authorName =
          formatDisplayName([
            replied.from.first_name,
            replied.from.last_name,
          ]) ??
          replied.from.username ??
          undefined;
      }
    }

    if (!messageToVerify) {
      await ctx.reply(MESSAGES.verifyOriginalMissing);
      return;
    }
    if (ctx.message.reply_to_message.from?.is_bot) {
      await ctx.reply(MESSAGES.verifyBotMessageBlocked);
      return;
    }

    const botSimilarity = findSimilarBotMessageInChat(
      database,
      chatId,
      messageToVerify,
      {
        threshold: SIMILARITY_THRESHOLD,
      },
    );
    if (botSimilarity.blocked) {
      await ctx.reply(MESSAGES.verifyBotMessageBlocked);
      return;
    }
    const chatTitle =
      "title" in ctx.chat && typeof ctx.chat.title === "string"
        ? ctx.chat.title
        : "username" in ctx.chat
          ? ctx.chat.username
          : undefined;

    const stopTyping = startTypingIndicator(ctx);
    const draftStreamer = createContextDraftStreamer(ctx);
    try {
      const { text } = await verifyMessageContent(
        messageToVerify,
        {
          authorName,
          chatTitle,
        },
        draftStreamer
          ? {
              onPartialText: (partialText) => draftStreamer.update(partialText),
            }
          : undefined,
      );

      await draftStreamer?.finish(text);

      if (text) {
        await replyWithLLMMessage(ctx, database, text, {
          replyToMessageId: replyToId,
        });
      } else {
        await ctx.reply(MESSAGES.verifyEmptyResult);
      }
    } finally {
      draftStreamer?.abort();
      stopTyping();
    }
  } catch (error) {
    console.error("Failed to process /verify command:", error);
    await notifyError(
      `Failed to process /verify command (chatId=${ctx.chat?.id ?? "unknown"})`,
      error,
    );
    try {
      await replyWithLLMMessage(ctx, database, GENERIC_ERROR_MESSAGE);
    } catch (replyError) {
      console.error("Failed to send /verify error message:", replyError);
      await notifyError("Failed to send /verify error message", replyError);
    }
  }
});

bot.command("fallacy_detector", (ctx) => {
  logCommandInvocation(ctx, "/fallacy_detector");
  return ctx.reply(MESSAGES.fallacyUnavailable);
});
bot.command("roast", async (ctx) => {
  try {
    const replyToMessage = ctx.message?.reply_to_message;
    const chatId = ctx.chat?.id;
    const directArgument = ctx.message?.text
      ? ctx.message.text.split(" ").slice(1).join(" ").trim()
      : "";
    const replyToId = replyToMessage?.message_id;

    logCommandInvocation(ctx, "/roast", [
      `ReplyToMessageId: ${replyToId ?? "none"}`,
      `Argument: ${directArgument || "[none provided]"}`,
    ]);

    let messageToRoast: string | undefined;
    let authorName: string | undefined;
    let authorId: number | undefined;
    let replyTargetId: number | undefined;

    if (replyToMessage && chatId) {
      const repliedMessageId = replyToMessage.message_id;
      try {
        const storedMessage = getMessageByChatAndMessageId(
          database,
          chatId,
          repliedMessageId,
        );
        const storedText = getStoredMessagePlainText(storedMessage)?.trim();
        if (storedText) {
          messageToRoast = storedText;
          authorId = storedMessage?.from_id ?? undefined;
          authorName =
            formatDisplayName([
              storedMessage?.from_first_name,
              storedMessage?.from_last_name,
            ]) ?? storedMessage?.from_username;
          replyTargetId = repliedMessageId;
        }
      } catch (dbError) {
        console.error(
          "Failed to retrieve message from database for /roast:",
          dbError,
        );
        await notifyError(
          "Failed to retrieve message from database for /roast command",
          dbError,
        );
      }

      if (!messageToRoast) {
        const replied = replyToMessage;
        const repliedText = getTelegramMessageText(replied)?.trim();
        if (repliedText) {
          messageToRoast = repliedText;
          replyTargetId = repliedMessageId;
        }
        if ("from" in replied && replied.from) {
          authorId = replied.from.id;
          if (!authorName) {
            authorName =
              formatDisplayName([
                replied.from.first_name,
                replied.from.last_name,
              ]) ??
              replied.from.username ??
              undefined;
          }
        }
      }
    }

    if (!messageToRoast && directArgument) {
      messageToRoast = directArgument;
    }

    if (!messageToRoast) {
      await ctx.reply(MESSAGES.roastMissingArgument);
      return;
    }

    if (replyToMessage?.from?.is_bot) {
      await ctx.reply(MESSAGES.roastBotMessageBlocked);
      return;
    }

    if (chatId) {
      const botSimilarity = findSimilarBotMessageInChat(
        database,
        chatId,
        messageToRoast,
        {
          threshold: SIMILARITY_THRESHOLD,
        },
      );
      if (botSimilarity.blocked) {
        await ctx.reply(MESSAGES.roastBotMessageBlocked);
        return;
      }
    }
    if (authorId && UNTOUCHABLE_USER_IDS.includes(authorId)) {
      await ctx.reply(MESSAGES.roastUntouchable);
      return;
    }

    const stopTyping = startTypingIndicator(ctx);
    const draftStreamer = createContextDraftStreamer(ctx);
    try {
      const { text } = await roastMessageContent(
        messageToRoast,
        {
          authorName,
          chatTitle:
            "title" in ctx.chat && typeof ctx.chat.title === "string"
              ? ctx.chat.title
              : "username" in ctx.chat
                ? ctx.chat.username
                : undefined,
        },
        draftStreamer
          ? {
              onPartialText: (partialText) => draftStreamer.update(partialText),
            }
          : undefined,
      );

      await draftStreamer?.finish(text);

      if (text) {
        await replyWithLLMMessage(
          ctx,
          database,
          text,
          replyTargetId ? { replyToMessageId: replyTargetId } : undefined,
        );
      } else {
        await ctx.reply(MESSAGES.modelEmptyResult);
      }
    } finally {
      draftStreamer?.abort();
      stopTyping();
    }
  } catch (error) {
    console.error("Failed to process /roast command:", error);
    await notifyError(
      `Failed to process /roast command (chatId=${ctx.chat?.id ?? "unknown"})`,
      error,
    );
    try {
      await replyWithLLMMessage(ctx, database, GENERIC_ERROR_MESSAGE);
    } catch (replyError) {
      console.error("Failed to send /roast error message:", replyError);
      await notifyError("Failed to send /roast error message", replyError);
    }
  }
});

bot.command("my_heresy", async (ctx) => {
  try {
    const replyToMessage = ctx.message?.reply_to_message;
    const chatId = ctx.chat?.id;
    const chatType = ctx.chat?.type;
    const replyToId = replyToMessage?.message_id;

    logCommandInvocation(ctx, "/my_heresy", [
      `ReplyToMessageId: ${replyToId ?? "none"}`,
    ]);

    if (!chatId || !chatType || chatType === "private") {
      await ctx.reply(MESSAGES.heresyGroupOnly);
      return;
    }

    if (!replyToMessage) {
      await ctx.reply(MESSAGES.heresyReplyRequired);
      return;
    }

    if (replyToMessage.from?.is_bot) {
      await ctx.reply(MESSAGES.heresyBotBlocked);
      return;
    }

    let authorId: number | undefined;
    let authorName: string | undefined;

    try {
      const storedMessage = getMessageByChatAndMessageId(
        database,
        chatId,
        replyToId ?? 0,
      );
      if (storedMessage) {
        authorId = storedMessage.from_id ?? undefined;
        authorName =
          formatDisplayName([
            storedMessage.from_first_name,
            storedMessage.from_last_name,
          ]) ??
          storedMessage.from_username ??
          undefined;
      }
    } catch (dbError) {
      console.error(
        "Failed to retrieve message from database for /my_heresy:",
        dbError,
      );
      await notifyError(
        "Failed to retrieve message from database for /my_heresy command",
        dbError,
      );
    }

    if (!authorId && replyToMessage.from) {
      authorId = replyToMessage.from.id;
      authorName =
        authorName ??
        formatDisplayName([
          replyToMessage.from.first_name,
          replyToMessage.from.last_name,
        ]) ??
        replyToMessage.from.username ??
        undefined;
    }

    if (!authorId) {
      await ctx.reply(MESSAGES.heresyUserMissing);
      return;
    }

    if (UNTOUCHABLE_USER_IDS.includes(authorId)) {
      await ctx.reply(MESSAGES.heresyUntouchable);
      return;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const cached = getHeresyCacheEntry(database, chatId, authorId);
    if (cached && nowSeconds - cached.created_at < HERESY_CACHE_TTL_SECONDS) {
      await replyWithLLMMessage(ctx, database, cached.response, {
        replyToMessageId: replyToId,
      });
      return;
    }

    const sinceDate = nowSeconds - HERESY_LOOKBACK_SECONDS;
    const recentMessages = getUserMessagesForHeresy(
      database,
      chatId,
      authorId,
      sinceDate,
      {
        limit: HERESY_MAX_MESSAGES,
        minLength: HERESY_MIN_LENGTH,
      },
    );

    const messageTexts = recentMessages
      .map((message) => message.text?.trim())
      .filter((text): text is string =>
        Boolean(text && text.length > HERESY_MIN_LENGTH),
      );

    if (messageTexts.length === 0) {
      await ctx.reply(MESSAGES.heresyInsufficientMaterial);
      return;
    }

    const stopTyping = startTypingIndicator(ctx);
    const draftStreamer = createContextDraftStreamer(ctx);
    try {
      const { text } = await detectUserHeresy(
        {
          authorName,
          chatTitle: ctx.chat.title,
          messages: messageTexts,
        },
        draftStreamer
          ? {
              onPartialText: (partialText) => draftStreamer.update(partialText),
            }
          : undefined,
      );

      await draftStreamer?.finish(text);

      if (text) {
        await replyWithLLMMessage(ctx, database, text, {
          replyToMessageId: replyToId,
        });
        storeHeresyCacheEntry(database, {
          chat_id: chatId,
          user_id: authorId,
          created_at: nowSeconds,
          response: text,
        });
      } else {
        await ctx.reply(MESSAGES.modelEmptyResult);
      }
    } finally {
      draftStreamer?.abort();
      stopTyping();
    }
  } catch (error) {
    console.error("Failed to process /my_heresy command:", error);
    await notifyError(
      `Failed to process /my_heresy command (chatId=${ctx.chat?.id ?? "unknown"})`,
      error,
    );
    try {
      await replyWithLLMMessage(ctx, database, GENERIC_ERROR_MESSAGE);
    } catch (replyError) {
      console.error("Failed to send /my_heresy error message:", replyError);
      await notifyError("Failed to send /my_heresy error message", replyError);
    }
  }
});

bot.command("ping", (ctx) => {
  logCommandInvocation(ctx, "/ping");
  return replyWithLLMMessage(ctx, database, MESSAGES.ping, {
    preferMarkdown: false,
  });
});

bot.on("message", async (ctx) => {
  if (!ctx.message) {
    return;
  }

  try {
    const rawMessage = mapToTelegramRawMessage(ctx.message);
    if (!rawMessage.text || rawMessage.text.trim() === "") {
      return;
    }

    const record = buildTelegramMessageRecord(rawMessage);
    storeTelegramMessage(database, record);

    if (ctx.chat?.id && isGroupChatType(ctx.chat.type) && isChatPaused(database, ctx.chat.id)) {
      return;
    }

    const isCommand = isCommandMessage(ctx.message.text, ctx.message.entities);
    const isAnonymousAdminMessage =
      "sender_chat" in ctx.message && ctx.message.sender_chat !== undefined;
    const privateQuestion = getPrivateChatAutoAskQuestion({
      chatType: ctx.chat?.type,
      text: rawMessage.text,
      isBot: ctx.message.from?.is_bot,
      isCommand,
      userId: ctx.message.from?.id,
      bannedUserIds: BANNED_USER_IDS,
    });
    const groupMentionQuestion = getGroupMentionAutoAskQuestion({
      chatType: ctx.chat?.type,
      text: rawMessage.text,
      entities: ctx.message.entities,
      botUsername: ctx.me.username,
      isBot: ctx.message.from?.is_bot,
      isAnonymousAdmin: isAnonymousAdminMessage,
      isCommand,
      userId: ctx.message.from?.id,
      bannedUserIds: BANNED_USER_IDS,
    });

    const question = privateQuestion ?? groupMentionQuestion;
    if (!question) {
      return;
    }

    const chatId = ctx.chat?.id;
    const requestMessageId = ctx.message.message_id;
    const messageThreadId = getTelegramMessageThreadId(ctx.message);

    if (!chatId || !requestMessageId) {
      await ctx.reply(GENERIC_ERROR_MESSAGE);
      return;
    }

    const jobKind = privateQuestion ? "ask" : "ask_group";
    const contextMessages =
      privateQuestion
        ? buildRecentPrivateContextMessages(
            chatId,
            requestMessageId,
            messageThreadId,
          )
        : jobKind === "ask_group"
        ? buildRecentGroupContextMessages(chatId, requestMessageId)
        : undefined;

    logCommandInvocation(ctx, privateQuestion ? "private_auto_ask" : "group_mention_auto_ask", [
      `Question: ${question}`,
    ]);

    enqueueLlmJob(database, {
      kind: jobKind,
      chatId,
      messageThreadId: privateQuestion ? messageThreadId : undefined,
      requestMessageId,
      question,
      contextMessages,
    });
    const pendingJobs = countPendingLlmJobsForChat(
      database,
      chatId,
      privateQuestion ? messageThreadId ?? null : undefined,
    );
    await replyWithLLMMessage(ctx, database, buildQueueReceivedMessage(pendingJobs), {
      preferMarkdown: false,
      replyToMessageId: requestMessageId,
      messageThreadId: privateQuestion ? messageThreadId : undefined,
    });
  } catch (error) {
    console.error("Failed to persist message:", error);
    await notifyError(
      `Failed to persist message (chatId=${ctx.chat?.id ?? "unknown"})`,
      error,
    );
  }
});

bot.catch(async (err) => {
  console.error("Error:", err);
  await notifyError("Unhandled bot error", err);
});

console.log("Starting bot...");
sendChannelLog("🚀 Bot starting...");
startLlmQueueWorker(bot, database, {
  onError: notifyError,
});
startBroadcastQueueWorker(bot, database, {
  onError: notifyError,
});
bot.start();
