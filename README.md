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
3. Si configuras `CHANNEL_LOGS_ID`, el bot envía cada día una copia comprimida de `veritheo.sqlite` a ese canal. Usa `DATABASE_BACKUP_HOUR_UTC` para elegir la hora UTC (el valor por defecto es `3`). La API en la nube de Telegram rechaza archivos de más de 50 MB. Si la copia supera ese tamaño, define `TELEGRAM_API_ROOT=http://localhost:8081` para subirla por un servidor local de Bot API (`telegram-bot-api --local`), que acepta hasta 2000 MB.
4. Configura `GOOGLE_GENERATIVE_AI_API_KEY` con una clave de [Google AI Studio](https://aistudio.google.com/apikey). El bot usa esta clave para Gemini Decisions y para generar respuestas con Gemini. El filtro contra inyección está activo por defecto. Usa `on` o `active` para activar las demás funciones con flag. El bot aún lee los flags `TYPESAFE_*` existentes si falta el flag `GEMINI_DECISIONS_*` correspondiente.

Los flags disponibles aparecen en [`.env.example`](.env.example). `GEMINI_DECISIONS_SPAM_GUARD` revisa los mensajes privados. Si detecta spam comercial, bloquea al usuario y guarda el bloqueo en la tabla `banned_users`.

El bot revisa las peticiones dirigidas a él y guarda un registro de los intentos detectados en SQLite. El filtro local detecta solicitudes directas de ejecutar comandos o consultar el servidor. Gemini Decisions cuenta un intento si estima una probabilidad de inyección de al menos 0.95. Tres mensajes distintos en 24 horas bloquean al usuario en Veritheo durante siete días. El bloqueo vence automáticamente y solo afecta al bot.

`GEMINI_DECISIONS_PROMPT_INJECTION_GUARD=off` desactiva la revisión con Gemini. El filtro local y los bloqueos vigentes siguen activos.

El enrutamiento de respuestas está siempre activo. [Gemini Decisions](https://ai.google.dev/gemini-api/docs/decisions-api) clasifica las respuestas a mensajes conversacionales del bot y mide su complejidad en una llamada. Si la categoría permite responder pero su confianza es menor a `0.65`, el bot usa la estrategia general. Si Gemini Decisions falla, el bot continúa con el flujo normal de mensajes.

Para respuestas sencillas, el bot usa Gemini 4 Hydrogen sin búsqueda web y con un límite de 400 tokens. Para respuestas complejas o de complejidad incierta, usa Gemini 4 Argon. Si falla la generación con Gemini, Grok conserva el mismo nivel de respuesta.

## Ejecución

```bash
bun run index.ts
```

Construido con TypeScript, Bun, y [grammy](https://grammy.dev/).
