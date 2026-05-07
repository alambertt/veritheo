import { xai } from '@ai-sdk/xai';
import { THEOLOGY_POLL_GROK_MODEL } from '../constants';
import { generateTextResponse } from './generate-text-response';
import { logTokenUsage } from './token-usage';

export const TELEGRAM_POLL_QUESTION_LIMIT = 300;
export const TELEGRAM_POLL_OPTION_LIMIT = 100;
export const TELEGRAM_POLL_EXPLANATION_LIMIT = 200;
export const THEOLOGY_POLL_OPTION_COUNT = 4;

export const THEOLOGY_POLL_TOPICS = [
  'La Trinidad',
  'Cristologia',
  'El canon biblico',
  'Los sacramentos',
  'Historia de la iglesia',
  'Interpretacion biblica',
  'La gracia',
  'Escatologia',
  'Apologetica',
  'Herejias historicas',
  'La justificacion',
  'La encarnacion',
] as const;

export type TheologyQuizPoll = {
  question: string;
  options: [string, string, string, string];
  correctOptionId: number;
  explanation: string;
  topic: string;
};

type SendPollApi = {
  sendPoll(
    chatId: number | string,
    question: string,
    options: string[],
    other: {
      type: 'quiz';
      is_anonymous: boolean;
      correct_option_id: number;
      explanation: string;
      message_thread_id?: number;
    },
  ): Promise<unknown>;
};

type RawTheologyQuizPoll = {
  question?: unknown;
  options?: unknown;
  correctOptionId?: unknown;
  correct_option_id?: unknown;
  explanation?: unknown;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function limitPollText(value: string, maxLength: number): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

export function pickRandomTheologyPollTopic(random: () => number = Math.random): string {
  const index = Math.floor(random() * THEOLOGY_POLL_TOPICS.length);
  return THEOLOGY_POLL_TOPICS[index] ?? THEOLOGY_POLL_TOPICS[0];
}

function detectPromptLanguage(topic: string, hasUserPrompt: boolean): 'en' | 'es' {
  if (!hasUserPrompt) {
    return 'es';
  }

  return /[¿¡áéíóúñ]|\b(el|la|los|las|de|del|que|sobre|iglesia|gracia)\b/i.test(topic) ? 'es' : 'en';
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Poll response did not contain a JSON object.');
  }
  return candidate.slice(start, end + 1);
}

function asNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Poll response is missing a valid ${fieldName}.`);
  }
  return value;
}

export function parseTheologyQuizPollJson(text: string, topic: string): TheologyQuizPoll {
  const parsed = JSON.parse(extractJsonObject(text)) as RawTheologyQuizPoll;
  const rawOptions = parsed.options;
  if (!Array.isArray(rawOptions)) {
    throw new Error('Poll response options must be an array.');
  }

  if (rawOptions.length !== THEOLOGY_POLL_OPTION_COUNT) {
    throw new Error('Poll response must include exactly four options.');
  }

  const options = rawOptions.map((option, index) =>
    limitPollText(asNonEmptyString(option, `option ${index + 1}`), TELEGRAM_POLL_OPTION_LIMIT),
  ) as [string, string, string, string];
  const correctOptionId =
    typeof parsed.correctOptionId === 'number' ? parsed.correctOptionId : parsed.correct_option_id;

  if (
    typeof correctOptionId !== 'number' ||
    !Number.isInteger(correctOptionId) ||
    correctOptionId < 0 ||
    correctOptionId >= THEOLOGY_POLL_OPTION_COUNT
  ) {
    throw new Error('Poll response is missing a valid correct option id.');
  }

  return {
    question: limitPollText(asNonEmptyString(parsed.question, 'question'), TELEGRAM_POLL_QUESTION_LIMIT),
    options,
    correctOptionId,
    explanation: limitPollText(asNonEmptyString(parsed.explanation, 'explanation'), TELEGRAM_POLL_EXPLANATION_LIMIT),
    topic,
  };
}

export function buildFallbackTheologyQuizPoll(topic: string, language: 'en' | 'es' = 'es'): TheologyQuizPoll {
  const normalizedTopic = limitPollText(topic || 'La teologia cristiana', 80);
  if (language === 'en') {
    return {
      question: limitPollText(`Which area primarily studies "${normalizedTopic}"?`, TELEGRAM_POLL_QUESTION_LIMIT),
      options: ['Christian doctrine', 'Modern astronomy', 'Applied mathematics', 'Political geography'],
      correctOptionId: 0,
      explanation: limitPollText(
        'This topic belongs to the study of Christian doctrine.',
        TELEGRAM_POLL_EXPLANATION_LIMIT,
      ),
      topic: normalizedTopic,
    };
  }

  return {
    question: limitPollText(
      `¿Que area estudia principalmente el tema "${normalizedTopic}"?`,
      TELEGRAM_POLL_QUESTION_LIMIT,
    ),
    options: ['Doctrina cristiana', 'Astronomia moderna', 'Matematica aplicada', 'Geografia politica'],
    correctOptionId: 0,
    explanation: limitPollText(
      'Este tema pertenece al estudio de la doctrina cristiana.',
      TELEGRAM_POLL_EXPLANATION_LIMIT,
    ),
    topic: normalizedTopic,
  };
}

function buildPollGenerationPrompt(topic: string, hasUserPrompt: boolean): string {
  return [
    'Create one native Telegram quiz poll for a theology group.',
    hasUserPrompt ? "Use the same language as the user's prompt." : 'Use Spanish because no user prompt was provided.',
    'Return only strict JSON with this exact shape:',
    '{"question":"...","options":["...","...","...","..."],"correctOptionId":0,"explanation":"..."}',
    'Rules:',
    '- question: 1-300 characters.',
    '- options: exactly 4 answer options, each 1-100 characters.',
    '- correctOptionId: integer from 0 to 3.',
    '- explanation: 1-200 characters, concise and educational.',
    '- Make the incorrect options plausible, not silly.',
    `Topic or prompt: ${topic}`,
  ].join('\n');
}

export async function generateTheologyQuizPoll(
  prompt?: string,
  options: { random?: () => number } = {},
): Promise<TheologyQuizPoll> {
  const userPrompt = prompt?.trim();
  const topic = userPrompt || pickRandomTheologyPollTopic(options.random);
  const hasUserPrompt = Boolean(userPrompt);
  const language = detectPromptLanguage(topic, hasUserPrompt);

  try {
    const { text, usage } = await generateTextResponse({
      model: xai.responses(THEOLOGY_POLL_GROK_MODEL),
      system: 'You generate concise, orthodox Christian theology quiz polls for Telegram. Return only valid JSON.',
      messages: [
        {
          role: 'user',
          content: buildPollGenerationPrompt(topic, hasUserPrompt),
        },
      ],
    });
    logTokenUsage('/theology_poll', usage);
    return parseTheologyQuizPollJson(text, topic);
  } catch (error) {
    console.warn('Failed to generate a valid theology poll. Falling back to a generic poll:', error);
    return buildFallbackTheologyQuizPoll(topic, language);
  }
}

export function sendTheologyQuizPoll(
  api: SendPollApi,
  params: {
    chatId: number | string;
    messageThreadId?: number;
    poll: TheologyQuizPoll;
  },
) {
  return api.sendPoll(params.chatId, params.poll.question, params.poll.options, {
    type: 'quiz',
    is_anonymous: true,
    correct_option_id: params.poll.correctOptionId,
    explanation: params.poll.explanation,
    ...(params.messageThreadId ? { message_thread_id: params.messageThreadId } : {}),
  });
}
