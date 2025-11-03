import { config } from "dotenv";
import { Bot, GrammyError } from "grammy";
import type { Context } from "grammy";
import type { ParseMode } from "grammy/types";
import { askHandler } from './services/ask';
import {
  buildTelegramMessageRecord,
  getMessagesByChat,
  initializeDatabase,
  mapToTelegramRawMessage,
  storeTelegramMessage,
} from './services/sqlite';
import { summarizeText } from './services/summarize';

config();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN environment variable is not set");
}

const bot = new Bot(token);
const database = initializeDatabase();

const TELEGRAM_MESSAGE_LIMIT = 4096;
const GENERIC_ERROR_MESSAGE =
  'Lo siento, ha ocurrido un error mientras procesaba tu solicitud. Por favor, inténtalo de nuevo más tarde.';

async function limitTelegramText(text: string): Promise<string> {
  if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
    return text;
  }
  return await summarizeText(text, TELEGRAM_MESSAGE_LIMIT);
}

async function replyWithLLMMessage(ctx: Context, text: string, options?: { preferMarkdown?: boolean }) {
  const limitedText = await limitTelegramText(text);
  const attempts: (ParseMode | undefined)[] =
    options?.preferMarkdown === false ? [undefined] : ['Markdown', undefined];
  let lastError: unknown;

  for (const parseMode of attempts) {
    try {
      const replyMessage = await ctx.reply(
        limitedText,
        parseMode ? { parse_mode: parseMode } : undefined
      );
      try {
        const botRawMessage = mapToTelegramRawMessage(replyMessage);
        const botRecord = buildTelegramMessageRecord(botRawMessage);
        storeTelegramMessage(database, botRecord);
      } catch (persistError) {
        console.error('Failed to persist bot reply message:', persistError);
      }
      return replyMessage;
    } catch (error) {
      lastError = error;
      if (parseMode) {
        const description =
          error instanceof GrammyError ? error.description : error instanceof Error ? error.message : String(error);
        console.warn(`Markdown send failed (${description}). Retrying without formatting.`);
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error('Failed to send reply.');
}

bot.command('start', ctx => {
  ctx.reply(
    'Bienvenido a Veritheo! 🙏 Soy tu asistente teológico. Hazme cualquier pregunta teológica y te ayudaré a explorar las profundidades de la fe y la verdad. Usa /help para más información.'
  );
});

bot.command('ask', async ctx => {
  try {
    const question = ctx.message?.text.split(' ').slice(1).join(' ');
    if (!question) {
      await ctx.reply('Por favor, proporciona una pregunta después del comando /ask.');
      return;
    }
    const response = await askHandler(question);
    if (response.text) {
      await replyWithLLMMessage(ctx, response.text);
    }
  } catch (error) {
    console.error('Failed to process /ask command:', error);
    try {
      await replyWithLLMMessage(ctx, GENERIC_ERROR_MESSAGE);
    } catch (replyError) {
      console.error('Failed to send /ask error message:', replyError);
    }
  }
});

bot.command("ask_group", async (ctx) => {
  try {
    const question = ctx.message?.text.split(' ').slice(1).join(' ').trim();
    console.log('🚀 ~ question:', question)
    if (!question) {
      await ctx.reply('Por favor, proporciona una pregunta después del comando /ask_group.');
      return;
    }

    let contextMessages: string[] | undefined;
    const chatId = ctx.chat?.id;
    if (chatId) {
      const storedMessages = getMessagesByChat(database, chatId, { limit: 10, order: 'desc' });
      const textMessages = storedMessages
        .filter((msg) => msg.text && msg.text.trim() !== '' && msg.message_id !== ctx.message?.message_id)
        .map((msg) => msg.text!.trim())
        .reverse();

      if (textMessages.length > 0) {
        contextMessages = textMessages;
      }
    }

    const response = await askHandler(question, contextMessages);
    if (response.text) {
      await replyWithLLMMessage(ctx, response.text);
    }
  } catch (error) {
    console.error('Failed to process /ask_group command:', error);
    try {
      await replyWithLLMMessage(ctx, GENERIC_ERROR_MESSAGE);
    } catch (replyError) {
      console.error('Failed to send /ask_group error message:', replyError);
    }
  }
});

bot.command("help", (ctx) => {
  ctx.reply(`
Bienvenido a Veritheo - Tu Guía Teológica

Comandos disponibles:
/ask - Pregunta lo que quieras en el chat privado
/ask_group - Pregunta en el grupo tomando como contexto los mensajes anteriores
/help - Lo que necesitas saber para utilizar este bot
/persona - Adopta una postura teológica por defecto y el bot responde con argumentos de dicha postura

Simplemente hazme cualquier pregunta teológica y te proporcionaré ideas y orientación.
  `.trim());
});

bot.command("persona", (ctx) => {
  ctx.reply("Adopta una postura teológica por defecto y el bot responde con argumentos de dicha postura");
});

bot.command("ping", (ctx) => {
  ctx.reply("🏓 Pong!");
});

bot.on("message", (ctx) => {
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
    console.error("Failed to persist message:", error);
  }
});

bot.catch((err) => {
  console.error("Error:", err);
});

console.log("Starting bot...");
bot.start();
