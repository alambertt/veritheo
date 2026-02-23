import { config } from 'dotenv';
import { Bot } from 'grammy';
import { askHandler } from './services/ask';
import { createChannelLogger, formatDisplayName } from './services/channel-logs';
import { detectMessageFallacies } from './services/fallacy-detector';
import { detectUserHeresy } from './services/heresy';
import { replyWithLLMMessage } from './services/reply';
import { roastMessageContent } from './services/roast';
import { buildSourcesMessage } from './services/sources';
import {
  buildTelegramMessageRecord,
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
import { verifyMessageContent } from './services/verify';
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

const GENERIC_ERROR_MESSAGE =
  'Lo siento, ha ocurrido un error mientras procesaba tu solicitud. Por favor, inténtalo de nuevo más tarde.';
const BANNED_COMMAND_MESSAGE = 'No tienes permisos para usar los comandos de este bot.';
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
  ctx.reply(
    'Bienvenido a Veritheo! 🙏 Soy tu asistente teológico. Hazme cualquier pregunta teológica y te ayudaré a explorar las profundidades de la fe y la verdad. Usa /help para más información.',
  );
});

bot.command('ask', async ctx => {
  try {
    const question = ctx.message?.text.split(' ').slice(1).join(' ');
    logCommandInvocation(ctx, '/ask', [`Question: ${question?.trim() || '[none provided]'}`]);
    if (!question) {
      await ctx.reply('Por favor, proporciona una pregunta después del comando /ask.');
      return;
    }
    const stopTyping = startTypingIndicator(ctx);
    try {
      const { text, sources } = await askHandler(question);
      if (text) {
        await replyWithLLMMessage(ctx, database, text);
        await sendChannelLog(`📝 /ask response\n${text}`);
      }
      const sourcesMessage = buildSourcesMessage(sources);
      if (sourcesMessage) {
        await replyWithLLMMessage(ctx, database, sourcesMessage);
      }
    } finally {
      stopTyping();
    }
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
      await ctx.reply('Por favor, proporciona una pregunta después del comando /ask_group.');
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

    const stopTyping = startTypingIndicator(ctx);
    try {
      const { text, sources } = await askHandler(question, contextMessages);
      if (text) {
        await replyWithLLMMessage(ctx, database, text);
      }
      const sourcesMessage = buildSourcesMessage(sources);
      if (sourcesMessage) {
        await replyWithLLMMessage(ctx, database, sourcesMessage);
      }
    } finally {
      stopTyping();
    }
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
  ctx.reply(
    `
Bienvenido a Veritheo - Tu Guía Teológica

Comandos disponibles:
/ask - Pregunta lo que quieras en el chat privado
/ask_group - Pregunta en el grupo tomando como contexto los mensajes anteriores
/help - Lo que necesitas saber para utilizar este bot
/persona - Adopta una postura teológica por defecto y el bot responde con argumentos de dicha postura
/verify - Responde a un mensaje para verificar su contenido y citar posibles errores
/fallacy_detector - Analiza un mensaje en busca de falacias argumentativas
/roast - Refuta un argumento usando los mejores contraargumentos del espectro teológico contrario
/my_heresy - Descubre tu herejía histórica según tus mensajes en el grupo

Simplemente hazme cualquier pregunta teológica y te proporcionaré ideas y orientación.
  `.trim(),
  );
});

bot.command('persona', ctx => {
  logCommandInvocation(ctx, '/persona');
  ctx.reply('Adopta una postura teológica por defecto y el bot responde con argumentos de dicha postura');
});

bot.command('verify', async ctx => {
  try {
    logCommandInvocation(ctx, '/verify', [`ReplyToMessageId: ${ctx.message?.reply_to_message?.message_id ?? 'none'}`]);
    if (!ctx.message?.reply_to_message || !ctx.chat?.id) {
      await ctx.reply('Por favor, responde al mensaje que deseas verificar y luego usa /verify.');
      return;
    }

    const replyToId = ctx.message.reply_to_message.message_id;
    const chatId = ctx.chat.id;
    let messageToVerify: string | undefined;
    let authorName: string | undefined;
    const authorId = ctx.message.reply_to_message.from?.id;

    if (authorId && UNTOUCHABLE_USER_IDS.includes(authorId)) {
      await ctx.reply(
        '😇 Este sabio infalible nunca se equivoca, así que no puedo verificar sus mensajes por respeto a su legendaria sabiduría. ✨',
      );
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
      await ctx.reply(
        'No pude encontrar el contenido del mensaje original. Asegúrate de responder a un mensaje de texto antes de usar /verify.',
      );
      return;
    }
    if (ctx.message.reply_to_message.from?.is_bot) {
      await ctx.reply('Lo siento, no puedo verificar mensajes que yo mismo haya enviado.');
      return;
    }

    const botSimilarity = findSimilarBotMessageInChat(database, chatId, messageToVerify, {
      threshold: SIMILARITY_THRESHOLD,
    });
    if (botSimilarity.blocked) {
      await ctx.reply('Lo siento, no puedo verificar mensajes que yo mismo haya enviado.');
      return;
    }
    const stopTyping = startTypingIndicator(ctx);
    try {
      const { text } = await verifyMessageContent(messageToVerify, {
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
        await ctx.reply('No se obtuvo un análisis válido del mensaje. Intenta nuevamente más tarde.');
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
      await ctx.reply('Por favor, responde al mensaje que deseas analizar y luego usa /fallacy_detector.');
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
      await ctx.reply(
        'No pude encontrar el contenido del mensaje original. Asegúrate de responder a un mensaje de texto antes de usar /fallacy_detector.',
      );
      return;
    }

    if (authorId && UNTOUCHABLE_USER_IDS.includes(authorId)) {
      await ctx.reply(
        '😇 Este sabio infalible nunca se equivoca, así que no puedo analizar sus mensajes por respeto a su legendaria sabiduría. ✨',
      );
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
        await ctx.reply('No se obtuvo un análisis válido del mensaje. Intenta nuevamente más tarde.');
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
      await ctx.reply('Por favor, responde a un mensaje o agrega el argumento después de /roast.');
      return;
    }

    if (replyToMessage?.from?.is_bot) {
      await ctx.reply('Lo siento, no puedo rostizar mensajes que yo mismo haya enviado.');
      return;
    }

    if (chatId) {
      const botSimilarity = findSimilarBotMessageInChat(database, chatId, messageToRoast, {
        threshold: SIMILARITY_THRESHOLD,
      });
      if (botSimilarity.blocked) {
        await ctx.reply('Lo siento, no puedo rostizar mensajes que yo mismo haya enviado.');
        return;
      }
    }
    if (authorId && UNTOUCHABLE_USER_IDS.includes(authorId)) {
      await ctx.reply(
        '😇 Este sabio infalible nunca se equivoca, así que no puedo rostizar sus mensajes por respeto a su legendaria sabiduría. ✨',
      );
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
        await ctx.reply('No se obtuvo una respuesta válida del modelo. Intenta nuevamente más tarde.');
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
      await ctx.reply('Este comando está pensado para grupos. Úsalo en un chat grupal respondiendo a un mensaje.');
      return;
    }

    if (!replyToMessage) {
      await ctx.reply('Responde a un mensaje del usuario para descubrir su herejía histórica.');
      return;
    }

    if (replyToMessage.from?.is_bot) {
      await ctx.reply('Lo siento, no puedo evaluar la herejía de mensajes enviados por bots.');
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
      await ctx.reply('No pude identificar al usuario. Responde a un mensaje válido e intenta de nuevo.');
      return;
    }

    if (UNTOUCHABLE_USER_IDS.includes(authorId)) {
      await ctx.reply(
        '😇 Este sabio infalible está más allá de las herejías terrenales. Mejor solo admirarlo desde lejos. ✨',
      );
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
      await ctx.reply(
        'No encontré suficientes mensajes largos del último año para ese usuario. Necesito más material de herejía.',
      );
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
        await ctx.reply('No se obtuvo una respuesta válida del modelo. Intenta nuevamente más tarde.');
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
  ctx.reply('🏓 Pong!');
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
bot.start();
