import { describe, expect, it } from "bun:test";
import { shouldUseLlmDraftStreaming } from "../services/llm-streaming-policy";

describe("shouldUseLlmDraftStreaming", () => {
  it("allows drafts in private chats", () => {
    expect(
      shouldUseLlmDraftStreaming({ chatId: 12345, chatType: "private" }),
    ).toBe(true);
  });

  it("allows drafts in group chats", () => {
    expect(
      shouldUseLlmDraftStreaming({ chatId: -10012345, chatType: "supergroup" }),
    ).toBe(true);
    expect(
      shouldUseLlmDraftStreaming({ chatId: -98765, chatType: "group" }),
    ).toBe(true);
  });

  it("allows queue jobs without chat type when the chat id is valid", () => {
    expect(shouldUseLlmDraftStreaming({ chatId: 12345 })).toBe(true);
    expect(shouldUseLlmDraftStreaming({ chatId: -10012345 })).toBe(true);
  });

  it("rejects invalid chat ids and unsupported chat types", () => {
    expect(shouldUseLlmDraftStreaming({ chatId: 0, chatType: "private" })).toBe(
      false,
    );
    expect(
      shouldUseLlmDraftStreaming({ chatId: -10012345, chatType: "channel" }),
    ).toBe(false);
    expect(shouldUseLlmDraftStreaming({})).toBe(false);
  });
});
