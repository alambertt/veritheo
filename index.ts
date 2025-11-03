import { config } from "dotenv";
import { Bot } from "grammy";
import { askExample } from './services/ask';
import {
  buildTelegramMessageRecord,
  initializeDatabase,
  mapToTelegramRawMessage,
  storeTelegramMessage,
} from './services/sqlite';

config();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN environment variable is not set");
}

const bot = new Bot(token);
const database = initializeDatabase();

bot.command("start", (ctx) => {
  ctx.reply("Bienvenido a Veritheo! 🙏 Soy tu asistente teológico. Hazme cualquier pregunta teológica y te ayudaré a explorar las profundidades de la fe y la verdad. Usa /help para más información.");
});

bot.command("ask", (ctx) => {
  ctx.reply("Pregunta lo que quieras en el chat privado");
});

bot.command("ask_group", (ctx) => {
  ctx.reply("Pregunta en el grupo tomando como contexto los mensajes anteriores");
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
