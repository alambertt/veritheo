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
4. Para activar las integraciones TypeSafe con flag, crea `TYPESAFE_API_KEY` en la consola de TypeSafe y cambia su flag correspondiente de `off` a `on`. También se acepta `active`. Esos flags están apagados por defecto. Si una integración falla, el bot conserva el flujo actual.

Las integraciones con flag son `TYPESAFE_SELF_MESSAGE_GUARD`, `TYPESAFE_ROAST_PREFLIGHT`, `TYPESAFE_HERESY_SELECTION`, `TYPESAFE_THEOLOGY_POLL_VALIDATION`, `TYPESAFE_VERIFY_CLAIMS` y `TYPESAFE_GROUP_CONTEXT_RANKING`.

El enrutamiento de respuestas está activo por defecto y no usa un flag. Clasifica las respuestas a mensajes conversacionales de Veritheo en chats privados y grupos. El bot guarda silencio ante respuestas vagas o con confianza menor a `0.65`. También usa la complejidad para elegir Gemini Flash-Lite en respuestas sencillas, o Gemini Pro cuando hace falta más análisis. Si la complejidad no está clara, usa Pro. TypeSafe clasifica el reply en una sola llamada. Las respuestas sencillas no habilitan búsqueda web y tienen un límite de 400 tokens. Si Gemini falla, Grok conserva el mismo nivel de respuesta. Si TypeSafe falla, conserva el flujo anterior.

## Ejecución

```bash
bun run index.ts
```

Construido con TypeScript, Bun, y [grammy](https://grammy.dev/).
