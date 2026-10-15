import { beforeEach, describe, expect, it, mock } from "bun:test";

const calls: Array<Record<string, unknown>> = [];
let generatedText = "mocked text result";
let generateTextImpl:
  | ((params: Record<string, unknown>) => Promise<Record<string, unknown>>)
  | undefined;

mock.module("ai", () => ({
  generateText: async (params: Record<string, unknown>) => {
    if (generateTextImpl) {
      const result = await generateTextImpl(params);
      calls.push(params);
      return result;
    }

    calls.push(params);
    return {
      text: generatedText,
      sources: [{ sourceType: "url", url: "https://example.com" }],
      providerMetadata: {
        google: {
          groundingMetadata: { foo: "bar" },
          safetyRatings: ["safe"],
        },
      },
    };
  },
}));

mock.module("@ai-sdk/google", () => ({
  google: Object.assign((model: string) => ({ model }), {
    tools: {
      googleSearch: () => "mock-search-tool",
    },
  }),
}));

mock.module("@ai-sdk/xai", () => ({
  xai: {
    responses: (model: string) => ({ model, provider: "xai" }),
    tools: {
      webSearch: () => "mock-web-search-tool",
    },
  },
}));

import { Database } from "bun:sqlite";
import { GrammyError } from "grammy";
import { setupSchema, getHeresyCacheEntry } from "../services/sqlite";
import { createHeresyCommandHandler } from "../services/heresy-command";
import { MESSAGES } from "../services/messages";
import { askHandler } from "../services/ask";
import { detectMessageFallacies } from "../services/fallacy-detector";
import { detectUserHeresy } from "../services/heresy";
import { roastMessageContent } from "../services/roast";
import { summarizeText } from "../services/summarize";
import { verifyMessageContent } from "../services/verify";

describe("AI-backed services", () => {
  beforeEach(() => {
    calls.length = 0;
    generatedText = "mocked text result";
    generateTextImpl = undefined;
  });

  it("returns ask handler results with metadata", async () => {
    const result = await askHandler("Question?", ["Context"]);

    expect((calls.at(-1) as any).model.model).toBe("gemini-4-argon");
    expect((calls.at(-1) as any).providerOptions.google.serviceTier).toBe("standard");
    expect(result.text).toBe("mocked text result");
    expect(result.sources).toEqual([
      { sourceType: "url", url: "https://example.com" },
    ]);
    expect(result.groundingMetadata).toEqual({ foo: "bar" });
    expect(result.safetyRatings).toEqual(["safe"]);
  });

  it("adds the active persona instruction to the model system prompt", async () => {
    await askHandler("Question?", undefined, { persona: "arriana" });

    const lastCall = calls.at(-1) as any;
    expect(lastCall.system).toContain("PERSONA ACTIVA: Arriana");
    expect(lastCall.system).toContain("militante");
    expect(lastCall.system).not.toContain("Eres neutral entre las corrientes");
  });

  it("uses the fast model without search and caps reply output", async () => {
    await askHandler("It was a joke.", undefined, {
      replyModelTier: "fast",
    });

    const lastCall = calls.at(-1) as any;
    expect(lastCall.model.model).toBe("gemini-3.8-flash");
    expect(lastCall.providerOptions.google.serviceTier).toBe("standard");
    expect(lastCall.tools).toBeUndefined();
    expect(lastCall.maxOutputTokens).toBe(400);
  });

  it("falls back to grok when google fails with a transient socket error", async () => {
    let invocation = 0;
    generateTextImpl = async (params) => {
      invocation += 1;

      if (invocation === 1) {
        throw new Error(
          "AI_APICallError: Cannot connect to API: The socket connection was closed unexpectedly.",
        );
      }

      return {
        text: "fallback answer",
        sources: [{ sourceType: "url", url: "https://fallback.example.com" }],
        providerMetadata: {
          xai: {
            foo: "bar",
          },
        },
      };
    };

    const result = await askHandler("Question?", undefined, {
      replyModelTier: "fast",
    });

    expect(result.text).toBe("fallback answer");
    expect(result.sources).toEqual([
      { sourceType: "url", url: "https://fallback.example.com" },
    ]);
    expect(invocation).toBe(2);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toEqual({ model: "grok-4.6", provider: "xai" });
    expect(calls[0]?.tools).toBeUndefined();
    expect(calls[0]?.maxOutputTokens).toBe(400);
    expect(calls[0]?.providerOptions).toEqual({
      xai: { reasoningEffort: "low" },
    });
  });

  it("falls back to grok when google returns AI_NoOutputGeneratedError", async () => {
    let invocation = 0;
    generateTextImpl = async (params) => {
      invocation += 1;

      if (invocation === 1) {
        const error = new Error(
          "AI_NoOutputGeneratedError: No output generated. Check the stream for errors.",
        );
        error.name = "AI_NoOutputGeneratedError";
        throw error;
      }

      return {
        text: "grok fallback answer",
        sources: [],
        providerMetadata: {
          xai: {},
        },
      };
    };

    const result = await askHandler("Question about safety-filtered content?");

    expect(result.text).toBe("grok fallback answer");
    expect(invocation).toBe(2);
  });

  it("builds verification prompt with optional context", async () => {
    await verifyMessageContent("Hola", {
      authorName: "Ada",
      chatTitle: "Grupo",
    });
    const lastCall = calls.at(-1) as any;
    const messageContent = lastCall.messages?.[0]?.content as string;

    expect(messageContent).toContain("Autor o remitente: Ada");
    expect(messageContent).toContain("Conversación: Grupo");
    expect(messageContent).toContain("Hola");
    expect(lastCall.model.model).toBe("gemini-4-argon");
    expect(lastCall.tools).toEqual({ google_search: "mock-search-tool" });
    expect(lastCall.providerOptions).toEqual({
      google: { serviceTier: "standard", thinkingConfig: { thinkingLevel: "medium" } },
    });
  });

  it("builds fallacy prompt with context", async () => {
    await detectMessageFallacies("Texto", { authorName: "Ada" });
    const lastCall = calls.at(-1) as any;
    const messageContent = lastCall.messages?.[0]?.content as string;

    expect(messageContent).toContain("Autor o remitente: Ada");
    expect(messageContent).toContain("Texto");
    expect(lastCall.model.model).toBe("gemini-3.8-flash");
    expect(lastCall.providerOptions).toEqual({ google: { serviceTier: "flex" } });
  });

  it("builds roast prompt with context", async () => {
    await roastMessageContent("Texto", { chatTitle: "Sala" });
    const lastCall = calls.at(-1) as any;
    const messageContent = lastCall.messages?.[0]?.content as string;

    expect(messageContent).toContain("Conversación: Sala");
    expect(messageContent).toContain("Texto");
  });

  it("summarizes and enforces length limit", async () => {
    const longInput = "x".repeat(200);
    const result = await summarizeText(longInput, 5);

    expect(result).toBe("mock…");
  });

  it("falls back when the model returns empty summary", async () => {
    generatedText = "";
    const longInput = "abcdefghij";
    const result = await summarizeText(longInput, 5);

    expect(result).toBe("abcd…");
  });

  describe("detectUserHeresy", () => {
    it("bounds saturation retries and the total generation deadline", async () => {
      await detectUserHeresy({ messages: ["Mensaje de prueba"] });
      const request = calls.at(-1) as any;
      expect(request.maxRetries).toBe(1);
      expect(request.timeout).toEqual({ totalMs: 60_000 });
      expect(request.providerOptions).toEqual({ google: { serviceTier: "flex" } });
      expect(request.model.model).toBe("gemini-4-argon");
    });

    it("returns the generated text", async () => {
      generatedText = "Eres un arriano moderno";
      const result = await detectUserHeresy({
        messages: ["Mensaje de prueba"],
      });

      expect(result.text).toBe("Eres un arriano moderno");
    });

    it("includes author name and chat title in the prompt", async () => {
      await detectUserHeresy({
        authorName: "Carlos",
        chatTitle: "Teología Geek",
        messages: ["Primera opinión", "Segunda opinión"],
      });

      const lastCall = calls.at(-1) as any;
      const content = lastCall.messages?.[0]?.content as string;

      expect(content).toContain("Autor o remitente: Carlos");
      expect(content).toContain("Conversación: Teología Geek");
      expect(content).toContain("- Primera opinión");
      expect(content).toContain("- Segunda opinión");
    });

    it("builds the prompt without optional context fields", async () => {
      await detectUserHeresy({ messages: ["Solo un mensaje"] });

      const lastCall = calls.at(-1) as any;
      const content = lastCall.messages?.[0]?.content as string;

      expect(content).not.toContain("Autor o remitente:");
      expect(content).not.toContain("Conversación:");
      expect(content).toContain("- Solo un mensaje");
    });

    it("uses the heresy system prompt", async () => {
      await detectUserHeresy({ messages: ["Texto"] });

      const lastCall = calls.at(-1) as any;
      expect(lastCall.system).toContain("herejía antigua o medieval");
    });

    it("formats multiple messages as a bullet list", async () => {
      const messages = ["Msg A", "Msg B", "Msg C"];
      await detectUserHeresy({ messages });

      const lastCall = calls.at(-1) as any;
      const content = lastCall.messages?.[0]?.content as string;

      expect(content).toContain("- Msg A\n- Msg B\n- Msg C");
    });
  });
});


describe("/my_heresy delivery", () => {
  function fixture() {
    const db = new Database(":memory:");
    setupSchema(db);
    db.run(`INSERT INTO messages (chat_id, chat_type, message_id, date, from_id, text)
      VALUES (-100, 'supergroup', 1, ?, 5, ?)`, [Math.floor(Date.now() / 1000), "Una opinión doctrinal. ".repeat(10)]);
    const replies: string[] = [];
    const errors: unknown[] = [];
    const ctx = {
      chat: { id: -100, type: "supergroup", title: "Test group" },
      message: { message_id: 10, message_thread_id: 9, reply_to_message: {
        message_id: 1, from: { id: 5, first_name: "Test", is_bot: false },
      } },
      reply: async (text: string) => { replies.push(text); },
      replyWithChatAction: async () => true,
      api: { raw: {}, sendChatAction: async () => true, sendMessage: async (chatId: number, text: string, options: any) => {
        replies.push(text);
        expect(options.message_thread_id).toBe(9);
        return { message_id: 50, date: 1, chat: { id: chatId, type: "supergroup" }, text };
      } },
    };
    const handler = createHeresyCommandHandler({ database: db, untouchableUserIds: [],
      notifyError: async (_label, error) => { errors.push(error); },
      logCommandInvocation: () => {},
    });
    return { db, replies, errors, ctx, handler };
  }

  beforeEach(() => {
    calls.length = 0;
    generatedText = "Resultado completo";
    generateTextImpl = undefined;
  });

  it("sends one clear unavailable reply for the reported retry exhaustion and never caches it", async () => {
    const f = fixture();
    const cause = Object.assign(new Error("This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later."), { statusCode: 503 });
    const error = Object.assign(new Error("Failed after 3 attempts"), { name: "AI_RetryError", lastError: cause });
    generateTextImpl = async () => { throw error; };
    await f.handler(f.ctx as any);
    expect(f.replies).toHaveLength(1);
    expect(f.replies[0]).toContain("alta demanda");
    expect(f.errors).toEqual([error]);
    expect(getHeresyCacheEntry(f.db, -100, 5)).toBeUndefined();
    f.db.close();
  });

  it("sends and caches one complete answer, then serves it without another provider call", async () => {
    const f = fixture();
    await f.handler(f.ctx as any);
    expect(f.replies).toEqual(["Resultado completo"]);
    expect(getHeresyCacheEntry(f.db, -100, 5)?.response).toBe("Resultado completo");
    await f.handler(f.ctx as any);
    expect(calls).toHaveLength(1);
    expect(f.replies).toEqual(["Resultado completo", "Resultado completo"]);
    f.db.close();
  });

  it("does not label credential failures as saturation", async () => {
    const f = fixture();
    generateTextImpl = async () => { throw Object.assign(new Error("Invalid key"), { statusCode: 401 }); };
    await f.handler(f.ctx as any);
    expect(f.replies).toHaveLength(1);
    expect(f.replies[0]).not.toContain("alta demanda");
    expect(getHeresyCacheEntry(f.db, -100, 5)).toBeUndefined();
    f.db.close();
  });

  it("reports a deadline failure without caching it", async () => {
    const f = fixture();
    generateTextImpl = async () => { throw new DOMException("Deadline exceeded", "TimeoutError"); };
    await f.handler(f.ctx as any);
    expect(f.replies).toEqual([MESSAGES.heresyUnavailable]);
    expect(getHeresyCacheEntry(f.db, -100, 5)).toBeUndefined();
    f.db.close();
  });

  it("does not repeat delivery when Telegram acknowledgment is lost", async () => {
    const f = fixture();
    f.ctx.api.sendMessage = async (_chatId: number, text: string) => {
      f.replies.push(text);
      throw new Error("Socket closed after send");
    };
    await f.handler(f.ctx as any);
    expect(f.replies).toEqual(["Resultado completo"]);
    expect(getHeresyCacheEntry(f.db, -100, 5)).toBeUndefined();
    expect(f.errors).toHaveLength(1);
    f.db.close();
  });

  it("does not send an error after the successful answer when cache storage fails", async () => {
    const f = fixture();
    f.db.run(`CREATE TRIGGER fail_cache BEFORE INSERT ON heresy_cache
      BEGIN SELECT RAISE(FAIL, 'cache unavailable'); END`);
    await f.handler(f.ctx as any);
    expect(f.replies).toEqual(["Resultado completo"]);
    expect(f.errors).toHaveLength(1);
    f.db.close();
  });

  it("sends user feedback before diagnostics and tolerates notification failure", async () => {
    const f = fixture();
    const error = Object.assign(new Error("Service unavailable"), { statusCode: 503 });
    generateTextImpl = async () => { throw error; };
    const handler = createHeresyCommandHandler({ database: f.db, untouchableUserIds: [],
      logCommandInvocation: () => {}, notifyError: async () => {
        expect(f.replies).toEqual([MESSAGES.heresyUnavailable]);
        throw new Error("Diagnostic channel unavailable");
      },
    });
    await handler(f.ctx as any);
    expect(f.replies).toEqual([MESSAGES.heresyUnavailable]);
    f.db.close();
  });

  it("never caches an empty model result", async () => {
    const f = fixture();
    generatedText = "";
    await f.handler(f.ctx as any);
    expect(f.replies).toEqual([MESSAGES.modelEmptyResult]);
    expect(getHeresyCacheEntry(f.db, -100, 5)).toBeUndefined();
    f.db.close();
  });

  it("falls back only after Telegram explicitly rejects formatting", async () => {
    const f = fixture();
    const send = f.ctx.api.sendMessage;
    let attempts = 0;
    f.ctx.api.sendMessage = async (chatId, text, options) => {
      attempts += 1;
      if (attempts === 1) {
        throw new GrammyError("Rejected", {
          ok: false, error_code: 400, description: "Bad Request: can't parse entities",
        }, "sendMessage", {});
      }
      return send(chatId, text, options);
    };
    await f.handler(f.ctx as any);
    expect(attempts).toBe(2);
    expect(f.replies).toEqual(["Resultado completo"]);
    expect(f.errors).toHaveLength(0);
    f.db.close();
  });

  it("does not resend when recording an already delivered Telegram message fails", async () => {
    const f = fixture();
    f.db.run(`CREATE TRIGGER fail_message BEFORE INSERT ON messages
      BEGIN SELECT RAISE(FAIL, 'message storage unavailable'); END`);
    await f.handler(f.ctx as any);
    expect(f.replies).toEqual(["Resultado completo"]);
    expect(f.errors).toHaveLength(1);
    expect(getHeresyCacheEntry(f.db, -100, 5)).toBeUndefined();
    f.db.close();
  });

  it("does not start an unbounded summarization call for an oversized answer", async () => {
    const f = fixture();
    generatedText = "Un análisis completo. ".repeat(400);
    await f.handler(f.ctx as any);
    expect(calls).toHaveLength(1);
    expect(f.replies).toHaveLength(1);
    expect(f.replies[0]!.length).toBeLessThanOrEqual(4096);
    expect(f.replies[0]).toContain("Respuesta recortada");
    expect(getHeresyCacheEntry(f.db, -100, 5)?.response).toBe(generatedText);
    f.db.close();
  });

});
