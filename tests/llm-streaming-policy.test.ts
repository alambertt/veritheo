import { describe, expect, it } from "bun:test";
import { shouldUseLlmDraftStreaming } from "../services/llm-streaming-policy";

describe("shouldUseLlmDraftStreaming", () => {
  it("allows drafts in private chats", () => {
    expect(
      shouldUseLlmDraftStreaming({ chatId: 12345, chatType: "private" }),
    ).toBe(true);
  });

  it("rejects drafts in group chats", () => {
    expect(
      shouldUseLlmDraftStreaming({ chatId: -10012345, chatType: "supergroup" }),
    ).toBe(false);
    expect(
      shouldUseLlmDraftStreaming({ chatId: -98765, chatType: "group" }),
    ).toBe(false);
  });

  it("allows queue jobs without chat type only for likely private chats", () => {
    expect(shouldUseLlmDraftStreaming({ chatId: 12345 })).toBe(true);
    expect(shouldUseLlmDraftStreaming({ chatId: -10012345 })).toBe(false);
  });

  it("rejects invalid chat ids and unsupported chat types", () => {
    expect(shouldUseLlmDraftStreaming({ chatId: 0, chatType: "private" })).toBe(
      false,
    );
    expect(
      shouldUseLlmDraftStreaming({ chatId: 12345, chatType: "channel" }),
    ).toBe(false);
    expect(shouldUseLlmDraftStreaming({})).toBe(false);
  });
});
