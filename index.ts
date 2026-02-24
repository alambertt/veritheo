import { config } from 'dotenv';
import { Bot } from 'grammy';
import { createChannelLogger, formatDisplayName } from './services/channel-logs';
import { detectMessageFallacies } from './services/fallacy-detector';
import { detectUserHeresy } from './services/heresy';
import { startLlmQueueWorker } from './services/llm-queue';
import { BANNED_COMMAND_MESSAGE, buildQueueReceivedMessage, GENERIC_ERROR_MESSAGE, MESSAGES } from './services/messages';
import { replyWithLLMMessage } from './services/reply';
import { roastMessageContent } from './services/roast';
import { verifyMessageContent } from './services/verify';
import {
  buildTelegramMessageRecord,
  countPendingLlmJobsForChat,
  enqueueLlmJob,
  getMessageByChatAndMessageId,
  getMessagesByChat,
  getHeresyCacheEntry,
  getUserMessagesForHeresy,
  initializeDatabase,
  mapToTelegramRawMessage,
  storeHeresyCacheEntry,
  storeTelegramMessage,
} from './services/sqlite';
import { findSimilarBotMessageInChat } from './services/self-message-guard';
import { startTypingIndicator } from './services/typing-indicator';
import { SIMILARITY_THRESHOLD } from './constants';

config();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN environment variable is not set');
}

const parseUserIdListEnv = (name: string): number[] => {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') {
    return [];
  }

  const parts = raw
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);

  const ids = parts.map(part => {
    const parsed = Number(part);
    if (!Number.isSafeInteger(parsed)) {
      throw new Error(`Invalid ${name} environment variable: "${part}" is not an integer user id`);
    }
    return parsed;
  });

  return Array.from(new Set(ids));
};

const parseUserIdEnv = (name: string): number | undefined => {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') {
    return undefined;
  }
  const parsed = Number(raw.trim());
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Invalid ${name} environment variable: "${raw}" is not an integer user id`);
  }
  return parsed;
};

const bot = new Bot(token);
const database = initializeDatabase();
const DEFAULT_UNTOUCHABLE_USER_IDS: number[] = [];
const configuredUntouchableUserIds = parseUserIdListEnv('UNTOUCHABLE_USER_IDS');
const UNTOUCHABLE_USER_IDS =
  configuredUntouchableUserIds.length > 0 ? configuredUntouchableUserIds : DEFAULT_UNTOUCHABLE_USER_IDS;
const configuredBannedUserId = parseUserIdEnv('BANNED_USER_ID');
const BANNED_USER_IDS = Array.from(
  new Set([...parseUserIdListEnv('BANNED_USER_IDS'), ...(configuredBannedUserId ? [configuredBannedUserId] : [])]),
);
const CHANNEL_LOGS_ID = process.env.CHANNEL_LOGS_ID ?? undefined;

const HERESY_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
const HERESY_LOOKBACK_SECONDS = 365 * 24 * 60 * 60;
const HERESY_MIN_LENGTH = 100;
const HERESY_MAX_MESSAGES = 20;

const { sendChannelLog, notifyError, logCommandInvocation } = createChannelLogger(token, CHANNEL_LOGS_ID);

const isCommandMessage = (text?: string, entities?: { type: string; offset: number; length: number }[]) => {
  if (!text || !entities) {
    return false;
  }
  return entities.some(entity => entity.type === 'bot_command' && entity.offset === 0);
};

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

  await next();
});

bot.command('start', ctx => {
  logCommandInvocation(ctx, '/start');
  ctx.reply(MESSAGES.start);
});

bot.command('ask', async ctx => {
  try {
    const question = ctx.message?.text.split(' ').slice(1).join(' ');
    logCommandInvocation(ctx, '/ask', [`Question: ${question?.trim() || '[none provided]'}`]);
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

    enqueueLlmJob(database, {
      kind: 'ask',
      chatId,
      requestMessageId,
      question: question.trim(),
    });
    const pendingJobs = countPendingLlmJobsForChat(database, chatId);
    await ctx.reply(buildQueueReceivedMessage(pendingJobs), {
      reply_to_message_id: requestMessageId,
    });
  } catch (error) {
    console.error('Failed to process /ask command:', error);
    await notifyError(`Failed to process /ask command (chatId=${ctx.chat?.id ?? 'unknown'})`, error);
    try {
      await replyWithLLMMessage(ctx, database, GENERIC_ERROR_MESSAGE);
    } catch (replyError) {
      console.error('Failed to send /ask error message:', replyError);
      await notifyError('Failed to send /ask error message', replyError);
    }
  }
});

bot.command('ask_group', async ctx => {
  try {
    const question = ctx.message?.text.split(' ').slice(1).join(' ').trim();
    console.log('🚀 ~ question:', question);
    logCommandInvocation(ctx, '/ask_group', [`Question: ${question || '[none provided]'}`]);
    let contextMessages: string[] | undefined;
    const chatId = ctx.chat?.id;

    if (!question) {
      await ctx.reply(MESSAGES.askGroupMissingQuestion);
      return;
    }

    if (chatId) {
      const storedMessages = getMessagesByChat(database, chatId, { limit: 10, order: 'desc' });
      const textMessages = storedMessages
        .filter(msg => msg.text && msg.text.trim() !== '' && msg.message_id !== ctx.message?.message_id)
        .map(msg => msg.text!.trim())
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
      kind: 'ask_group',
      chatId,
      requestMessageId,
      question,
      contextMessages,
    });
    const pendingJobs = countPendingLlmJobsForChat(database, chatId);
    await ctx.reply(buildQueueReceivedMessage(pendingJobs), {
      reply_to_message_id: requestMessageId,
    });
  } catch (error) {
    console.error('Failed to process /ask_group command:', error);
    await notifyError(`Failed to process /ask_group command (chatId=${ctx.chat?.id ?? 'unknown'})`, error);
    try {
      await replyWithLLMMessage(ctx, database, GENERIC_ERROR_MESSAGE);
    } catch (replyError) {
      console.error('Failed to send /ask_group error message:', replyError);
      await notifyError('Failed to send /ask_group error message', replyError);
    }
  }
});

bot.command('help', ctx => {
  logCommandInvocation(ctx, '/help');
  ctx.reply(MESSAGES.help);
});

bot.command('persona', ctx => {
  logCommandInvocation(ctx, '/persona');
  ctx.reply(MESSAGES.persona);
});

bot.command('verify', async ctx => {
  try {
    logCommandInvocation(ctx, '/verify', [`ReplyToMessageId: ${ctx.message?.reply_to_message?.message_id ?? 'none'}`]);
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
      const storedMessage = getMessageByChatAndMessageId(database, chatId, replyToId);
      if (storedMessage?.text?.trim()) {
        messageToVerify = storedMessage.text.trim();
        authorName =
          formatDisplayName([storedMessage.from_first_name, storedMessage.from_last_name]) ??
          storedMessage.from_username;
      }
    } catch (dbError) {
      console.error('Failed to retrieve message from database:', dbError);
      await notifyError('Failed to retrieve message from database for /verify command', dbError);
    }

    if (!messageToVerify) {
      const replied = ctx.message.reply_to_message;
      // Fallback al payload original entregado por la API de Telegram cuando la BD no tiene el mensaje.
      const repliedText =
        'text' in replied && typeof replied.text === 'string'
          ? replied.text
          : 'caption' in replied && typeof replied.caption === 'string'
            ? replied.caption
            : undefined;
      if (repliedText?.trim()) {
        messageToVerify = repliedText.trim();
      }
      if (!authorName && 'from' in replied && replied.from) {
        authorName =
          formatDisplayName([replied.from.first_name, replied.from.last_name]) ?? replied.from.username ?? undefined;
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

    const botSimilarity = findSimilarBotMessageInChat(database, chatId, messageToVerify, {
      threshold: SIMILARITY_THRESHOLD,
    });
    if (botSimilarity.blocked) {
      await ctx.reply(MESSAGES.verifyBotMessageBlocked);
      return;
    }
    const chatTitle =
      'title' in ctx.chat && typeof ctx.chat.title === 'string'
        ? ctx.chat.title
        : 'username' in ctx.chat
          ? ctx.chat.username
          : undefined;

    const stopTyping = startTypingIndicator(ctx);
    try {
      const { text } = await verifyMessageContent(messageToVerify, {
        authorName,
        chatTitle,
      });

      if (text) {
        await replyWithLLMMessage(ctx, database, text, { replyToMessageId: replyToId });
      } else {
        await ctx.reply(MESSAGES.verifyEmptyResult);
      }
    } finally {
      stopTyping();
    }
  } catch (error) {
    console.error('Failed to process /verify command:', error);
    await notifyError(`Failed to process /verify command (chatId=${ctx.chat?.id ?? 'unknown'})`, error);
    try {
      await replyWithLLMMessage(ctx, database, GENERIC_ERROR_MESSAGE);
    } catch (replyError) {
      console.error('Failed to send /verify error message:', replyError);
      await notifyError('Failed to send /verify error message', replyError);
    }
  }
});

bot.command('fallacy_detector', async ctx => {
  try {
    logCommandInvocation(ctx, '/fallacy_detector', [
      `ReplyToMessageId: ${ctx.message?.reply_to_message?.message_id ?? 'none'}`,
    ]);
    if (!ctx.message?.reply_to_message || !ctx.chat?.id) {
      await ctx.reply(MESSAGES.fallacyReplyRequired);
      return;
    }

    const replyToId = ctx.message.reply_to_message.message_id;
    const chatId = ctx.chat.id;
    let messageToAnalyze: string | undefined;
    let authorName: string | undefined;
    let authorId: number | undefined;

    try {
      const storedMessage = getMessageByChatAndMessageId(database, chatId, replyToId);
      if (storedMessage?.text?.trim()) {
        messageToAnalyze = storedMessage.text.trim();
        authorId = storedMessage.from_id ?? undefined;
        authorName =
          formatDisplayName([storedMessage.from_first_name, storedMessage.from_last_name]) ??
          storedMessage.from_username;
      }
    } catch (dbError) {
      console.error('Failed to retrieve message from database for /fallacy_detector:', dbError);
      await notifyError('Failed to retrieve message from database for /fallacy_detector command', dbError);
    }

    if (!messageToAnalyze) {
      const replied = ctx.message.reply_to_message;
      const repliedText =
        'text' in replied && typeof replied.text === 'string'
          ? replied.text
          : 'caption' in replied && typeof replied.caption === 'string'
            ? replied.caption
            : undefined;
      if (repliedText?.trim()) {
        messageToAnalyze = repliedText.trim();
      }
      if ('from' in replied && replied.from) {
        authorId = replied.from.id;
        if (!authorName) {
          authorName =
            formatDisplayName([replied.from.first_name, replied.from.last_name]) ?? replied.from.username ?? undefined;
        }
      }
    }

    if (!messageToAnalyze) {
      await ctx.reply(MESSAGES.fallacyOriginalMissing);
      return;
    }

    if (authorId && UNTOUCHABLE_USER_IDS.includes(authorId)) {
      await ctx.reply(MESSAGES.fallacyUntouchable);
      return;
    }

    const stopTyping = startTypingIndicator(ctx);
    try {
      const { text } = await detectMessageFallacies(messageToAnalyze, {
        authorName,
        chatTitle:
          'title' in ctx.chat && typeof ctx.chat.title === 'string'
            ? ctx.chat.title
            : 'username' in ctx.chat
              ? ctx.chat.username
              : undefined,
      });

      if (text) {
        await replyWithLLMMessage(ctx, database, text, { replyToMessageId: replyToId });
      } else {
        await ctx.reply(MESSAGES.fallacyEmptyResult);
      }
    } finally {
      stopTyping();
    }
  } catch (error) {
    console.error('Failed to process /fallacy_detector command:', error);
    await notifyError(`Failed to process /fallacy_detector command (chatId=${ctx.chat?.id ?? 'unknown'})`, error);
    try {
      await replyWithLLMMessage(ctx, database, GENERIC_ERROR_MESSAGE);
    } catch (replyError) {
      console.error('Failed to send /fallacy_detector error message:', replyError);
      await notifyError('Failed to send /fallacy_detector error message', replyError);
    }
  }
});

bot.command('roast', async ctx => {
  try {
    const replyToMessage = ctx.message?.reply_to_message;
    const chatId = ctx.chat?.id;
    const directArgument = ctx.message?.text ? ctx.message.text.split(' ').slice(1).join(' ').trim() : '';
    const replyToId = replyToMessage?.message_id;

    logCommandInvocation(ctx, '/roast', [
      `ReplyToMessageId: ${replyToId ?? 'none'}`,
      `Argument: ${directArgument || '[none provided]'}`,
    ]);

    let messageToRoast: string | undefined;
    let authorName: string | undefined;
    let authorId: number | undefined;
    let replyTargetId: number | undefined;

    if (replyToMessage && chatId) {
      const repliedMessageId = replyToMessage.message_id;
      try {
        const storedMessage = getMessageByChatAndMessageId(database, chatId, repliedMessageId);
        if (storedMessage?.text?.trim()) {
          messageToRoast = storedMessage.text.trim();
          authorId = storedMessage.from_id ?? undefined;
          authorName =
            formatDisplayName([storedMessage.from_first_name, storedMessage.from_last_name]) ??
            storedMessage.from_username;
          replyTargetId = repliedMessageId;
        }
      } catch (dbError) {
        console.error('Failed to retrieve message from database for /roast:', dbError);
        await notifyError('Failed to retrieve message from database for /roast command', dbError);
      }

      if (!messageToRoast) {
        const replied = replyToMessage;
        const repliedText =
          'text' in replied && typeof replied.text === 'string'
            ? replied.text
            : 'caption' in replied && typeof replied.caption === 'string'
              ? replied.caption
              : undefined;
        if (repliedText?.trim()) {
          messageToRoast = repliedText.trim();
          replyTargetId = repliedMessageId;
        }
        if ('from' in replied && replied.from) {
          authorId = replied.from.id;
          if (!authorName) {
            authorName =
              formatDisplayName([replied.from.first_name, replied.from.last_name]) ??
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
      const botSimilarity = findSimilarBotMessageInChat(database, chatId, messageToRoast, {
        threshold: SIMILARITY_THRESHOLD,
      });
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
    try {
      const { text } = await roastMessageContent(messageToRoast, {
        authorName,
        chatTitle:
          'title' in ctx.chat && typeof ctx.chat.title === 'string'
            ? ctx.chat.title
            : 'username' in ctx.chat
              ? ctx.chat.username
              : undefined,
      });

      if (text) {
        await replyWithLLMMessage(ctx, database, text, replyTargetId ? { replyToMessageId: replyTargetId } : undefined);
      } else {
        await ctx.reply(MESSAGES.modelEmptyResult);
      }
    } finally {
      stopTyping();
    }
  } catch (error) {
    console.error('Failed to process /roast command:', error);
    await notifyError(`Failed to process /roast command (chatId=${ctx.chat?.id ?? 'unknown'})`, error);
    try {
      await replyWithLLMMessage(ctx, database, GENERIC_ERROR_MESSAGE);
    } catch (replyError) {
      console.error('Failed to send /roast error message:', replyError);
      await notifyError('Failed to send /roast error message', replyError);
    }
  }
});

bot.command('my_heresy', async ctx => {
  try {
    const replyToMessage = ctx.message?.reply_to_message;
    const chatId = ctx.chat?.id;
    const chatType = ctx.chat?.type;
    const replyToId = replyToMessage?.message_id;

    logCommandInvocation(ctx, '/my_heresy', [`ReplyToMessageId: ${replyToId ?? 'none'}`]);

    if (!chatId || !chatType || chatType === 'private') {
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
      const storedMessage = getMessageByChatAndMessageId(database, chatId, replyToId ?? 0);
      if (storedMessage) {
        authorId = storedMessage.from_id ?? undefined;
        authorName =
          formatDisplayName([storedMessage.from_first_name, storedMessage.from_last_name]) ??
          storedMessage.from_username ??
          undefined;
      }
    } catch (dbError) {
      console.error('Failed to retrieve message from database for /my_heresy:', dbError);
      await notifyError('Failed to retrieve message from database for /my_heresy command', dbError);
    }

    if (!authorId && replyToMessage.from) {
      authorId = replyToMessage.from.id;
      authorName =
        authorName ??
        formatDisplayName([replyToMessage.from.first_name, replyToMessage.from.last_name]) ??
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
      await replyWithLLMMessage(ctx, database, cached.response, { replyToMessageId: replyToId });
      return;
    }

    const sinceDate = nowSeconds - HERESY_LOOKBACK_SECONDS;
    const recentMessages = getUserMessagesForHeresy(database, chatId, authorId, sinceDate, {
      limit: HERESY_MAX_MESSAGES,
      minLength: HERESY_MIN_LENGTH,
    });

    const messageTexts = recentMessages
      .map(message => message.text?.trim())
      .filter((text): text is string => Boolean(text && text.length > HERESY_MIN_LENGTH));

    if (messageTexts.length === 0) {
      await ctx.reply(MESSAGES.heresyInsufficientMaterial);
      return;
    }

    const stopTyping = startTypingIndicator(ctx);
    try {
      const { text } = await detectUserHeresy({
        authorName,
        chatTitle: ctx.chat.title,
        messages: messageTexts,
      });

      if (text) {
        await replyWithLLMMessage(ctx, database, text, { replyToMessageId: replyToId });
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
      stopTyping();
    }
  } catch (error) {
    console.error('Failed to process /my_heresy command:', error);
    await notifyError(`Failed to process /my_heresy command (chatId=${ctx.chat?.id ?? 'unknown'})`, error);
    try {
      await replyWithLLMMessage(ctx, database, GENERIC_ERROR_MESSAGE);
    } catch (replyError) {
      console.error('Failed to send /my_heresy error message:', replyError);
      await notifyError('Failed to send /my_heresy error message', replyError);
    }
  }
});

bot.command('ping', ctx => {
  logCommandInvocation(ctx, '/ping');
  ctx.reply(MESSAGES.ping);
});

bot.on('message', async ctx => {
  if (!ctx.message) {
    return;
  }

  try {
    const rawMessage = mapToTelegramRawMessage(ctx.message);
    if (!rawMessage.text || rawMessage.text.trim() === '') {
      return;
    }

    const record = buildTelegramMessageRecord(rawMessage);
    storeTelegramMessage(database, record);
  } catch (error) {
    console.error('Failed to persist message:', error);
    await notifyError(`Failed to persist message (chatId=${ctx.chat?.id ?? 'unknown'})`, error);
  }
});

bot.catch(async err => {
  console.error('Error:', err);
  await notifyError('Unhandled bot error', err);
});

console.log('Starting bot...');
sendChannelLog('🚀 Bot starting...');
startLlmQueueWorker(bot, database, {
  onError: notifyError,
});
bot.start();
