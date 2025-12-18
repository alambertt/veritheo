import { config } from 'dotenv';
import { Bot } from 'grammy';
import { askHandler } from './services/ask';
import {
  buildTelegramMessageRecord,
  getMessagesByChat,
  getMessageByChatAndMessageId,
  initializeDatabase,
  mapToTelegramRawMessage,
  storeTelegramMessage,
} from './services/sqlite';
import { verifyMessageContent } from './services/verify';
import { detectMessageFallacies } from './services/fallacy-detector';
import { replyWithLLMMessage } from './services/reply';
import { buildSourcesMessage } from './services/sources';
import { startTypingIndicator } from './services/typing-indicator';
import { createChannelLogger, formatChatLabel, formatDisplayName, formatUserLabel } from './services/channel-logs';

config();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN environment variable is not set');
}

const bot = new Bot(token);
const database = initializeDatabase();
const UNTOUCHABLE_USER_IDS = [738668189, 929608851];
const CHANNEL_LOGS_ID = process.env.CHANNEL_LOGS_ID ?? undefined;

const GENERIC_ERROR_MESSAGE =
  'Lo siento, ha ocurrido un error mientras procesaba tu solicitud. Por favor, inténtalo de nuevo más tarde.';

const { sendChannelLog, notifyError, logCommandInvocation } = createChannelLogger(token, CHANNEL_LOGS_ID);

bot.command('start', ctx => {
  logCommandInvocation(ctx, '/start');
  ctx.reply(
    'Bienvenido a Veritheo! 🙏 Soy tu asistente teológico. Hazme cualquier pregunta teológica y te ayudaré a explorar las profundidades de la fe y la verdad. Usa /help para más información.'
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

Simplemente hazme cualquier pregunta teológica y te proporcionaré ideas y orientación.
  `.trim()
  );
});

bot.command('persona', ctx => {
  logCommandInvocation(ctx, '/persona');
  ctx.reply('Adopta una postura teológica por defecto y el bot responde con argumentos de dicha postura');
});

bot.command('verify', async ctx => {
  try {
    logCommandInvocation(ctx, '/verify', [
      `ReplyToMessageId: ${ctx.message?.reply_to_message?.message_id ?? 'none'}`,
    ]);
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
      await ctx.reply('😇 Este sabio infalible nunca se equivoca, así que no puedo verificar sus mensajes por respeto a su legendaria sabiduría. ✨');
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
        'No pude encontrar el contenido del mensaje original. Asegúrate de responder a un mensaje de texto antes de usar /verify.'
      );
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
        'No pude encontrar el contenido del mensaje original. Asegúrate de responder a un mensaje de texto antes de usar /fallacy_detector.'
      );
      return;
    }

    if (authorId && UNTOUCHABLE_USER_IDS.includes(authorId)) {
      await ctx.reply('😇 Este sabio infalible nunca se equivoca, así que no puedo analizar sus mensajes por respeto a su legendaria sabiduría. ✨');
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
