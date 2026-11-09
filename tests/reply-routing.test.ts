import { afterEach, describe, expect, it } from "bun:test";
import {
  buildReplyRoutingState,
  classifyBotReply,
  REPLY_ROUTING_MIN_CONFIDENCE,
  REPLY_SYSTEM_INSTRUCTIONS,
  resolveBotReplyStrategy,
} from "../services/reply-routing";
import {
  isTypeSafeFeatureActive,
  resetTypeSafeClientForTests,
  setTypeSafeSystemOneForTests,
} from "../services/typesafe";

afterEach(() => {
  resetTypeSafeClientForTests();
  delete process.env.TYPESAFE_REPLY_ROUTING;
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

  it("classifies a reply with Jev and returns its confidence", async () => {
    process.env.TYPESAFE_REPLY_ROUTING = "off";
    let capturedRequest: unknown;
    setTypeSafeSystemOneForTests(async (request) => {
      capturedRequest = request;
      return {
        model: "test-model",
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
        usage: { input_tokens: 1, output_tokens: 1 },
      } as never;
    });
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
    expect(capturedRequest).toMatchObject({ state });
    expect(REPLY_SYSTEM_INSTRUCTIONS.add_context).toContain("refine");
  });

  it("routes replies that need careful reasoning to the reasoning tier", async () => {
    setTypeSafeSystemOneForTests(async () =>
      ({
        model: "test-model",
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
        usage: { input_tokens: 1, output_tokens: 1 },
      }) as never,
    );

    const result = await classifyBotReply({
      previousMessages: [{ speaker: "user", text: "The passage means X." }],
      botMessage: "That passage supports X.",
      userReply: "The surrounding argument seems to contradict that reading.",
    });

    expect(result?.modelTier).toBe("reasoning");
  });

  it("uses the reasoning tier when complexity is uncertain", async () => {
    setTypeSafeSystemOneForTests(async () =>
      ({
        model: "test-model",
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
        usage: { input_tokens: 1, output_tokens: 1 },
      }) as never,
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

  it("keeps reply routing active even when its legacy flag is off", async () => {
    process.env.TYPESAFE_REPLY_ROUTING = "off";
    expect(isTypeSafeFeatureActive("reply-routing")).toBe(true);
  });
});
