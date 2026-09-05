# Veritheo - Bot Asistente Teológico

Un bot de Telegram que responde preguntas teológicas con imparcialidad y verdad.

## Comandos Disponibles

- `/start` - Mensaje de bienvenida
- `/ask` - Pregunta lo que quieras en el chat privado
  - En chat privado también puedes escribir tu pregunta directamente sin usar el comando
- `/ask_group` - Pregunta en el grupo tomando como contexto los mensajes anteriores
- `/help` - Lo que necesitas saber para utilizar este bot
- `/persona` - Consulta o cambia la postura teológica en el chat privado
- `/persona <valor>` - Activa una postura, por ejemplo `/persona metodista_wesleyana` o `/persona arriana`
- `/verify` - Responde a un mensaje para verificar su contenido y citar posibles errores
- `/roast` - Refuta un argumento usando los mejores contraargumentos del espectro teológico contrario

## Instalación

```bash
bun install
```

## Configuración

1. Copia `.env.example` a `.env`
2. Agrega tu token de bot de Telegram desde [@BotFather](https://t.me/BotFather)
3. Si configuras `CHANNEL_LOGS_ID`, el bot envía cada día una copia comprimida de `veritheo.sqlite` a ese canal. Usa `DATABASE_BACKUP_HOUR_UTC` para elegir la hora UTC (el valor por defecto es `3`).

## Ejecución

```bash
bun run index.ts
```

Construido con TypeScript, Bun, y [grammy](https://grammy.dev/).
