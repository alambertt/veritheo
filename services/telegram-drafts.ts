import { GrammyError, type Api } from "grammy";

const TELEGRAM_DRAFT_TEXT_LIMIT = 4096;
// Telegram answers 429 when drafts arrive faster than about one per second.
const TELEGRAM_DRAFT_UPDATE_INTERVAL_MS = 1000;
const MAX_DRAFT_ID = 2_147_483_647;

type SendMessageDraftPayload = {
  chat_id: number;
  message_thread_id?: number;
  draft_id: number;
  text: string;
};

type DraftCapableRawApi = {
  sendMessageDraft(payload: SendMessageDraftPayload): Promise<true>;
};

export interface TelegramDraftStreamer {
  update(text: string): Promise<void>;
  finish(text?: string): Promise<void>;
  abort(): void;
}

function buildDraftText(text: string): string {
  if (text.length <= TELEGRAM_DRAFT_TEXT_LIMIT) {
    return text;
  }

  return `${text.slice(0, TELEGRAM_DRAFT_TEXT_LIMIT - 1)}…`;
}

function createDraftId(): number {
  const candidate = Math.floor(Math.random() * MAX_DRAFT_ID);
  return candidate === 0 ? 1 : candidate;
}

export function supportsTelegramDraftStreaming(chatId: number): boolean {
  return Number.isSafeInteger(chatId) && chatId > 0;
}

export function createTelegramDraftStreamer(
  api: Api,
  params: { chatId: number; messageThreadId?: number; draftId?: number },
): TelegramDraftStreamer {
  const rawApi = api.raw as unknown as DraftCapableRawApi;
  const draftId = params.draftId ?? createDraftId();

  let latestText = "";
  let lastSentText = "";
  let lastSentAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue = Promise.resolve();
  let finished = false;
  let blockedUntil = 0;

  const clearTimer = () => {
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    timer = undefined;
  };

  const sendDraft = async (text: string) => {
    if (
      finished ||
      Date.now() < blockedUntil ||
      text.trim() === "" ||
      text === lastSentText
    ) {
      return;
    }

    try {
      await rawApi.sendMessageDraft({
        chat_id: params.chatId,
        ...(params.messageThreadId
          ? { message_thread_id: params.messageThreadId }
          : {}),
        draft_id: draftId,
        text,
      });
      lastSentText = text;
      lastSentAt = Date.now();
    } catch (error) {
      if (error instanceof GrammyError && error.error_code === 429) {
        // Drafts are optional. Stay silent until Telegram allows more.
        blockedUntil =
          Date.now() + (error.parameters?.retry_after ?? 5) * 1000;
        return;
      }
      if (error instanceof GrammyError && error.error_code === 400) {
        // The chat or topic cannot take drafts. More attempts fail the same way.
        finished = true;
        clearTimer();
      }
      console.warn("Failed to send Telegram message draft:", error);
    }
  };

  const flush = async (force = false) => {
    if (finished) {
      return;
    }

    const nextText = buildDraftText(latestText);
    if (nextText.trim() === "" || nextText === lastSentText) {
      return;
    }

    if (lastSentText === "") {
      clearTimer();
      queue = queue.then(
        () => sendDraft(nextText),
        () => sendDraft(nextText),
      );
      await queue;
      return;
    }

    const elapsed = Date.now() - lastSentAt;

    if (!force && elapsed < TELEGRAM_DRAFT_UPDATE_INTERVAL_MS) {
      const waitTime = TELEGRAM_DRAFT_UPDATE_INTERVAL_MS - elapsed;
      if (!timer) {
        timer = setTimeout(() => {
          timer = undefined;
          void flush(true);
        }, waitTime);
      }
      return;
    }

    clearTimer();
    queue = queue.then(
      () => sendDraft(nextText),
      () => sendDraft(nextText),
    );
    await queue;
  };

  return {
    async update(text: string) {
      latestText = text;
      await flush(false);
    },
    async finish(text?: string) {
      if (typeof text === "string") {
        latestText = text;
      }

      clearTimer();
      await flush(true);
      finished = true;
    },
    abort() {
      finished = true;
      clearTimer();
    },
  };
}
