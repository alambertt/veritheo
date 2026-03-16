export const GOOGLE_MODEL_BASIC = 'gemini-3.1-flash-lite-preview';
export const GOOGLE_MODEL_PRO = "gemini-3.1-pro-preview";
export const GOOGLE_MODEL_LATEST = "gemini-3.1-pro-preview";
export const SIMILARITY_THRESHOLD = 0.91;

export const GROK_MODEL = "grok-4-1-fast-reasoning";
export const ZHIPU_MODEL = "glm-5";

export const TELEGRAM_CUSTOM_EMOJI_MAP = {
  "🤡": "5316602649779384632",
  "🫠": "5276248296707342359",
  "😏": "5375170473095077321",
  "🙃": "5353058903418488524",
  "🤨": "5461009521969217001",
  "💀": "5379930048478330552",
  "😇": "5312029583350969360",
  "🔥": "5424972470023104089",
  "👑": "5433758796289685818",
  "🧠": "5237799019329105246",
  "✨": "5325547803936572038",
  "🙏": "5472189549473963781",
  "✔️": "5206607081334906820",
  "🏓": "5269563867305879894",
  "👀": "5210956306952758910",
  "🕯️": "5253717838870363235",
  "🧩": "5429368540849260641",
  "🏛️": "5359778044745622115",
} as const satisfies Record<string, string>;
