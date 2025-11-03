import { config } from "dotenv";
import { Bot } from "grammy";
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
const BOT_ID = process.env.BOT_ID || "";

async function limitTelegramText(text: string): Promise<string> {
  if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
    return text;
  }
  return await summarizeText(text, TELEGRAM_MESSAGE_LIMIT);
}

bot.command('start', ctx => {
  ctx.reply(
    'Bienvenido a Veritheo! 🙏 Soy tu asistente teológico. Hazme cualquier pregunta teológica y te ayudaré a explorar las profundidades de la fe y la verdad. Usa /help para más información.'
  );
});

bot.command('ask', async ctx => {
  const question = ctx.message?.text.split(' ').slice(1).join(' ');
  if (!question) {
    ctx.reply('Por favor, proporciona una pregunta después del comando /ask.');
    return;
  }
  const response = await askHandler(question);
  if (response.text) {
    await ctx.reply(await limitTelegramText(response.text), { parse_mode: 'Markdown' });
  }
});

bot.command("ask_group", async (ctx) => {
  const question = ctx.message?.text.split(' ').slice(1).join(' ').trim();
  console.log('🚀 ~ question:', question)
  if (!question) {
    ctx.reply('Por favor, proporciona una pregunta después del comando /ask_group.');
    return;
  }

  const chatId = ctx.chat?.id;
  let contextMessages: string[] | undefined;

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
    const recordQuestion = buildTelegramMessageRecord(mapToTelegramRawMessage(ctx.message!));
    storeTelegramMessage(database, recordQuestion);
    const recordAnswer = buildTelegramMessageRecord({
      ...mapToTelegramRawMessage(ctx.message!),
      text: response.text,
      from_id: parseInt(BOT_ID),
      from_is_bot: true,
    });
    storeTelegramMessage(database, recordAnswer);
    await ctx.reply(await limitTelegramText(response.text), { parse_mode: 'Markdown' });
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
