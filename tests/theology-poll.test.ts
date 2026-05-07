import { beforeEach, describe, expect, it, mock } from "bun:test";

const calls: Array<Record<string, unknown>> = [];
let generatedText = "";
let generateTextImpl:
  | ((params: Record<string, unknown>) => Promise<{
      text: string;
      sources: undefined;
      providerMetadata: undefined;
      usage: undefined;
    }>)
  | undefined;

mock.module("ai", () => ({
  generateText: async (params: Record<string, unknown>) => {
    calls.push(params);
    if (generateTextImpl) {
      return generateTextImpl(params);
    }
    return {
      text: generatedText,
      sources: undefined,
      providerMetadata: undefined,
      usage: undefined,
    };
  },
}));

mock.module("@ai-sdk/xai", () => ({
  xai: {
    responses: (model: string) => ({ model, provider: "xai" }),
  },
}));

import {
  buildFallbackTheologyQuizPoll,
  generateTheologyQuizPoll,
  limitPollText,
  parseTheologyQuizPollJson,
  pickRandomTheologyPollTopic,
  sendTheologyQuizPoll,
  TELEGRAM_POLL_EXPLANATION_LIMIT,
  TELEGRAM_POLL_OPTION_LIMIT,
  TELEGRAM_POLL_QUESTION_LIMIT,
  THEOLOGY_POLL_TOPICS,
} from "../services/theology-poll";
import { THEOLOGY_POLL_GROK_MODEL } from "../constants";

describe("theology poll generation", () => {
  beforeEach(() => {
    calls.length = 0;
    generateTextImpl = undefined;
    generatedText = JSON.stringify({
      question: "Who defended Nicene orthodoxy against Arianism?",
      options: ["Athanasius", "Arius", "Pelagius", "Nestorius"],
      correctOptionId: 0,
      explanation: "Athanasius is closely associated with defending Nicaea.",
    });
  });

  it("parses valid model JSON into a quiz poll", () => {
    const poll = parseTheologyQuizPollJson(generatedText, "Nicaea");

    expect(poll.question).toContain("Nicene");
    expect(poll.options).toEqual([
      "Athanasius",
      "Arius",
      "Pelagius",
      "Nestorius",
    ]);
    expect(poll.correctOptionId).toBe(0);
    expect(poll.explanation).toContain("Athanasius");
  });

  it("rejects model JSON with the wrong number of options", () => {
    expect(() =>
      parseTheologyQuizPollJson(
        JSON.stringify({
          question: "Question?",
          options: ["One", "Two", "Three"],
          correctOptionId: 0,
          explanation: "Explanation",
        }),
        "Bad options",
      ),
    ).toThrow("exactly four options");
  });

  it("clamps Telegram poll field lengths", () => {
    const poll = parseTheologyQuizPollJson(
      JSON.stringify({
        question: "Q".repeat(TELEGRAM_POLL_QUESTION_LIMIT + 20),
        options: [
          "A".repeat(TELEGRAM_POLL_OPTION_LIMIT + 20),
          "B",
          "C",
          "D",
        ],
        correctOptionId: 1,
        explanation: "E".repeat(TELEGRAM_POLL_EXPLANATION_LIMIT + 20),
      }),
      "Long text",
    );

    expect(poll.question.length).toBe(TELEGRAM_POLL_QUESTION_LIMIT);
    expect(poll.options[0].length).toBe(TELEGRAM_POLL_OPTION_LIMIT);
    expect(poll.explanation.length).toBe(TELEGRAM_POLL_EXPLANATION_LIMIT);
  });

  it("falls back safely when model output is invalid", async () => {
    generatedText = "not json";

    const poll = await generateTheologyQuizPoll("Council of Chalcedon");

    expect(poll.topic).toBe("Council of Chalcedon");
    expect(poll.question).toContain("Which area");
    expect(poll.options).toHaveLength(4);
    expect(poll.correctOptionId).toBe(0);
  });

  it("uses a curated random topic when no prompt is provided", async () => {
    generatedText = JSON.stringify({
      question: "¿Que doctrina afirma un solo Dios en tres personas?",
      options: ["La Trinidad", "El arrianismo", "El docetismo", "El pelagianismo"],
      correctOptionId: 0,
      explanation: "La Trinidad confiesa un Dios en tres personas.",
    });

    const poll = await generateTheologyQuizPoll(undefined, { random: () => 0 });

    expect(poll.topic).toBe(THEOLOGY_POLL_TOPICS[0]);
    const lastCall = calls.at(-1) as any;
    expect(lastCall.model).toEqual({
      model: THEOLOGY_POLL_GROK_MODEL,
      provider: "xai",
    });
    expect(lastCall.messages?.[0]?.content).toContain(THEOLOGY_POLL_TOPICS[0]);
    expect(lastCall.messages?.[0]?.content).toContain("Use Spanish");
  });

  it("sends native Telegram quiz polls with thread ids", async () => {
    const sendCalls: Array<Record<string, unknown>> = [];
    const api = {
      sendPoll: async (
        chatId: number,
        question: string,
        options: string[],
        other: Record<string, unknown>,
      ) => {
        sendCalls.push({ chatId, question, options, other });
      },
    };
    const poll = buildFallbackTheologyQuizPoll("La Trinidad");

    await sendTheologyQuizPoll(api, {
      chatId: -100,
      messageThreadId: 42,
      poll,
    });

    expect(sendCalls[0]).toMatchObject({
      chatId: -100,
      other: {
        type: "quiz",
        is_anonymous: true,
        correct_option_id: 0,
        message_thread_id: 42,
      },
    });
  });

  it("normalizes and clamps standalone poll text", () => {
    expect(limitPollText("  A    B  ", 10)).toBe("A B");
    expect(limitPollText("abcdef", 4)).toBe("abc…");
  });

  it("picks deterministic curated topics for tests", () => {
    expect(pickRandomTheologyPollTopic(() => 0)).toBe(THEOLOGY_POLL_TOPICS[0]);
  });
});
