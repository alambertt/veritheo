export const GENERIC_ERROR_MESSAGE =
  'Lo siento, ha ocurrido un error mientras procesaba tu solicitud. Por favor, inténtalo de nuevo más tarde.';

export const BANNED_COMMAND_MESSAGE = 'No tienes permisos para usar los comandos de este bot.';

export const MESSAGES = {
  start:
    'Bienvenido a Veritheo! 🙏 Soy tu asistente teológico. Hazme cualquier pregunta teológica y te ayudaré a explorar las profundidades de la fe y la verdad. Usa /help para más información.',
  help: `
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
  persona: 'Adopta una postura teológica por defecto y el bot responde con argumentos de dicha postura',
  askMissingQuestion: 'Por favor, proporciona una pregunta después del comando /ask.',
  askGroupMissingQuestion: 'Por favor, proporciona una pregunta después del comando /ask_group.',
  queueReceived: '✅ Recibido. Estoy procesando tu solicitud.',
  verifyReplyRequired: 'Por favor, responde al mensaje que deseas verificar y luego usa /verify.',
  verifyUntouchable:
    '😇 Este sabio infalible nunca se equivoca, así que no puedo verificar sus mensajes por respeto a su legendaria sabiduría. ✨',
  verifyOriginalMissing:
    'No pude encontrar el contenido del mensaje original. Asegúrate de responder a un mensaje de texto antes de usar /verify.',
  verifyBotMessageBlocked: 'Lo siento, no puedo verificar mensajes que yo mismo haya enviado.',
  verifyEmptyResult: 'No se obtuvo una verificación válida del mensaje. Intenta nuevamente más tarde.',
  fallacyReplyRequired: 'Por favor, responde al mensaje que deseas analizar y luego usa /fallacy_detector.',
  fallacyOriginalMissing:
    'No pude encontrar el contenido del mensaje original. Asegúrate de responder a un mensaje de texto antes de usar /fallacy_detector.',
  fallacyUntouchable:
    '😇 Este sabio infalible nunca se equivoca, así que no puedo analizar sus mensajes por respeto a su legendaria sabiduría. ✨',
  fallacyEmptyResult: 'No se obtuvo un análisis válido del mensaje. Intenta nuevamente más tarde.',
  roastMissingArgument: 'Por favor, responde a un mensaje o agrega el argumento después de /roast.',
  roastBotMessageBlocked: 'Lo siento, no puedo rostizar mensajes que yo mismo haya enviado.',
  roastUntouchable:
    '😇 Este sabio infalible nunca se equivoca, así que no puedo rostizar sus mensajes por respeto a su legendaria sabiduría. ✨',
  modelEmptyResult: 'No se obtuvo una respuesta válida del modelo. Intenta nuevamente más tarde.',
  heresyGroupOnly: 'Este comando está pensado para grupos. Úsalo en un chat grupal respondiendo a un mensaje.',
  heresyReplyRequired: 'Responde a un mensaje del usuario para descubrir su herejía histórica.',
  heresyBotBlocked: 'Lo siento, no puedo evaluar la herejía de mensajes enviados por bots.',
  heresyUserMissing: 'No pude identificar al usuario. Responde a un mensaje válido e intenta de nuevo.',
  heresyUntouchable:
    '😇 Este sabio infalible está más allá de las herejías terrenales. Mejor solo admirarlo desde lejos. ✨',
  heresyInsufficientMaterial:
    'No encontré suficientes mensajes largos del último año para ese usuario. Necesito más material de herejía.',
  ping: '🏓 Pong!',
} as const;

export const buildQueueReceivedMessage = (pendingJobs: number) =>
  pendingJobs > 1
    ? `✅ Recibido. Hay ${pendingJobs - 1} solicitud(es) antes de la tuya en la cola.`
    : MESSAGES.queueReceived;
