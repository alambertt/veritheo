import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
  buildReplyRoutingState,
  classifyBotReply,
  REPLY_ROUTING_MIN_CONFIDENCE,
  REPLY_SYSTEM_INSTRUCTIONS,
  resolveBotReplyStrategy,
} from "../services/reply-routing";
const originalApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const originalLegacyFlag = process.env.TYPESAFE_REPLY_ROUTING;
let fetchMock: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

beforeEach(() => {
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
  fetchMock = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected request"));
});

afterEach(() => {
  fetchMock.mockRestore();
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = originalApiKey;
  process.env.TYPESAFE_REPLY_ROUTING = originalLegacyFlag;
});

describe("bot reply routing", () => {
  it("builds a text-only conversation state without user names", () => {
    expect(
      buildReplyRoutingState({
        previousMessages: [
          { text: "  Earlier question  ", from_is_bot: false },
          { text: "  Previous answer  ", from_is_bot: true },
          { text: "   ", from_is_bot: false },
        ],
        botMessage: "  Current answer  ",
        userReply: "  A little more context  ",
      }),
    ).toEqual({
      previousMessages: [
        { speaker: "user", text: "Earlier question" },
        { speaker: "bot", text: "Previous answer" },
      ],
      botMessage: "Current answer",
      userReply: "A little more context",
    });
  });

  it("classifies a reply in one Gemini Decisions request with the legacy flag off", async () => {
    process.env.TYPESAFE_REPLY_ROUTING = "off";
    fetchMock.mockResolvedValue(
      Response.json({
        answers: {
          action: {
            type: "choice",
            choice: "add_context",
            confidence: 0.92,
            probabilities: { add_context: 0.92, ignore: 0.08 },
          },
          complexity: {
            type: "score",
            score: 0.1,
            confidence: 0.9,
            legend: { "0": "simple", "1": "complex" },
            probabilities: { "0": 0.9, "1": 0.1 },
          },
        },
        usage: { total_input_tokens: 12, total_output_tokens: 0 },
      }),
    );
    const state = buildReplyRoutingState({
      previousMessages: [{ text: "My church is in Lima." }],
      botMessage: "The doctrine developed in several regions.",
      userReply: "I meant the church in Peru.",
    });

    const result = await classifyBotReply(state);

    expect(result).toEqual({
      action: "add_context",
      confidence: 0.92,
      modelTier: "fast",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/decisions");
    expect(request).toMatchObject({
      method: "POST",
      headers: { "x-goog-api-key": "test-key", "Content-Type": "application/json" },
    });
    expect(request?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(request?.body as string)).toMatchObject({
      model: "gemini-decision-1",
      input: JSON.stringify(state),
      questions: {
        action: { type: "choice", criteria: { add_context: expect.any(String) } },
        complexity: { type: "score", criteria: [expect.any(String), expect.any(String)] },
      },
    });
    expect(REPLY_SYSTEM_INSTRUCTIONS.add_context).toContain("refine");
  });

  it("routes replies that need careful reasoning to the reasoning tier", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        answers: {
          action: {
            type: "choice",
            choice: "disagreement",
            confidence: 0.91,
            probabilities: { disagreement: 0.91, ignore: 0.09 },
          },
          complexity: {
            type: "score",
            score: 0.84,
            confidence: 0.88,
            legend: { "0": "simple", "1": "complex" },
            probabilities: { "0": 0.16, "1": 0.84 },
          },
        },
      }),
    );

    const result = await classifyBotReply({
      previousMessages: [{ speaker: "user", text: "The passage means X." }],
      botMessage: "That passage supports X.",
      userReply: "The surrounding argument seems to contradict that reading.",
    });

    expect(result?.modelTier).toBe("reasoning");
  });

  it("uses the reasoning tier when complexity is uncertain", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        answers: {
          action: {
            type: "choice",
            choice: "follow_up",
            confidence: 0.91,
            probabilities: { follow_up: 0.91, ignore: 0.09 },
          },
          complexity: {
            type: "score",
            score: 0.1,
            confidence: 0.4,
            legend: { "0": "simple", "1": "complex" },
            probabilities: { "0": 0.6, "1": 0.4 },
          },
        },
      }),
    );

    const result = await classifyBotReply({
      previousMessages: [],
      botMessage: "Previous answer",
      userReply: "Could you explain that more?",
    });

    expect(result?.modelTier).toBe("reasoning");
  });

  it("stays silent only on ignore and uses general when the label is uncertain", () => {
    expect(REPLY_ROUTING_MIN_CONFIDENCE).toBe(0.65);
    expect(resolveBotReplyStrategy({ action: "playful", confidence: 0.65 })).toBe("playful");
    expect(resolveBotReplyStrategy({ action: "follow_up", confidence: 0.64 })).toBe("general");
    expect(resolveBotReplyStrategy({ action: "disagreement", confidence: 0.5 })).toBe("general");
    expect(resolveBotReplyStrategy({ action: "ignore", confidence: 0.3 })).toBeUndefined();
    expect(resolveBotReplyStrategy({ action: "ignore", confidence: 0.99 })).toBeUndefined();
  });

  it("always answers a forced reply (bot mention or always-answer user)", () => {
    const forced = { forceReply: true };
    expect(resolveBotReplyStrategy({ action: "disagreement", confidence: 0.56 }, forced)).toBe("general");
    expect(resolveBotReplyStrategy({ action: "ignore", confidence: 0.99 }, forced)).toBe("general");
    expect(resolveBotReplyStrategy({ action: "follow_up", confidence: 0.9 }, forced)).toBe("follow_up");
  });
});
