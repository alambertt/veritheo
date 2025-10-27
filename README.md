# Veritheo - Bot Asistente Teológico

Un bot de Telegram que responde preguntas teológicas con imparcialidad y verdad.

## Comandos Disponibles

- `/start` - Mensaje de bienvenida
- `/ask` - Pregunta lo que quieras en el chat privado
- `/ask_group` - Pregunta en el grupo tomando como contexto los mensajes anteriores
- `/help` - Lo que necesitas saber para utilizar este bot
- `/persona` - Adopta una postura teológica por defecto y el bot responde con argumentos de dicha postura

## Instalación

```bash
bun install
```

## Configuración

1. Copia `.env.example` a `.env`
2. Agrega tu token de bot de Telegram desde [@BotFather](https://t.me/BotFather)

## Ejecución

```bash
bun run index.ts
```

Construido con TypeScript, Bun, y [grammy](https://grammy.dev/).
