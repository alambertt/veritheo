import { describe, expect, it } from "bun:test";
import { getGuestBotQuestion, getGuestQueryId } from "../services/guest-bot";

describe("guest bot helpers", () => {
  it("extracts the guest query id", () => {
    expect(getGuestQueryId({ guest_query_id: "guest-123" })).toBe("guest-123");
    expect(getGuestQueryId({})).toBeUndefined();
  });

  it("removes the summoned bot mention from guest questions", () => {
    const result = getGuestBotQuestion({
      message: {
        guest_query_id: "guest-123",
        text: "@Veritheo what does covenant mean?",
        entities: [{ type: "mention", offset: 0, length: 9 }],
        from: { id: 1, username: "ada", first_name: "Ada", is_bot: false },
        chat: { id: -1001, title: "Theology" },
      },
      botUsername: "veritheo",
    });

    expect(result?.question).toBe("what does covenant mean?");
    expect(result?.from).toMatchObject({ id: 1, username: "ada" });
    expect(result?.chat).toMatchObject({ id: -1001, title: "Theology" });
  });

  it("ignores replied message context when the summon has no prompt", () => {
    const result = getGuestBotQuestion({
      message: {
        guest_query_id: "guest-123",
        text: "@veritheo",
        entities: [{ type: "mention", offset: 0, length: 9 }],
        from: { id: 1, is_bot: false },
        reply_to_message: {
          text: "Original claim to analyze",
        },
      },
      botUsername: "veritheo",
    });

    expect(result).toBeUndefined();
  });

  it("does not include replied message context with a guest prompt", () => {
    const result = getGuestBotQuestion({
      message: {
        guest_query_id: "guest-123",
        text: "@veritheo answer only this",
        entities: [{ type: "mention", offset: 0, length: 9 }],
        from: { id: 1, is_bot: false },
        reply_to_message: {
          text: "Do not use this as context",
        },
      },
      botUsername: "veritheo",
    });

    expect(result).toEqual({
      question: "answer only this",
      messageId: undefined,
      from: {
        id: 1,
        username: undefined,
        first_name: undefined,
        last_name: undefined,
      },
      chat: undefined,
    });
  });

  it("ignores guest messages that do not tag the bot", () => {
    expect(
      getGuestBotQuestion({
        message: {
          guest_query_id: "guest-123",
          text: "Can you answer this follow-up?",
          from: { id: 1, is_bot: false },
          reply_to_message: {
            text: "Previous guest bot response",
          },
        },
        botUsername: "veritheo",
      }),
    ).toBeUndefined();

    expect(
      getGuestBotQuestion({
        message: {
          guest_query_id: "guest-123",
          text: "@otherbot answer this",
          entities: [{ type: "mention", offset: 0, length: 9 }],
          from: { id: 1, is_bot: false },
        },
        botUsername: "veritheo",
      }),
    ).toBeUndefined();
  });

  it("ignores bot and banned-user guest messages", () => {
    expect(
      getGuestBotQuestion({
        message: {
          text: "@veritheo question",
          from: { id: 1, is_bot: true },
        },
        botUsername: "veritheo",
      }),
    ).toBeUndefined();

    expect(
      getGuestBotQuestion({
        message: {
          text: "@veritheo question",
          from: { id: 7, is_bot: false },
        },
        botUsername: "veritheo",
        bannedUserIds: [7],
      }),
    ).toBeUndefined();
  });

  it("ignores slash commands in guest messages", () => {
    expect(
      getGuestBotQuestion({
        message: {
          text: "/ask @veritheo who are you?",
          entities: [
            { type: "bot_command", offset: 0, length: 4 },
            { type: "mention", offset: 5, length: 9 },
          ],
          from: { id: 1, is_bot: false },
        },
        botUsername: "veritheo",
      }),
    ).toBeUndefined();
  });
});
