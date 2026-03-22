import { describe, expect, it } from "bun:test";
import { getPrivateChatAutoAskQuestion } from "../services/private-chat-auto-ask";

describe("getPrivateChatAutoAskQuestion", () => {
  it("returns the trimmed message text for private chats", () => {
    expect(
      getPrivateChatAutoAskQuestion({
        chatType: "private",
        text: "  ¿Qué significa gracia común?  ",
      }),
    ).toBe("¿Qué significa gracia común?");
  });

  it("returns undefined outside private chats", () => {
    expect(
      getPrivateChatAutoAskQuestion({
        chatType: "supergroup",
        text: "Pregunta",
      }),
    ).toBeUndefined();
  });

  it("returns undefined for command messages", () => {
    expect(
      getPrivateChatAutoAskQuestion({
        chatType: "private",
        text: "/ask Pregunta",
        isCommand: true,
      }),
    ).toBeUndefined();
  });

  it("returns undefined for banned users and bots", () => {
    expect(
      getPrivateChatAutoAskQuestion({
        chatType: "private",
        text: "Pregunta",
        userId: 42,
        bannedUserIds: [42],
      }),
    ).toBeUndefined();

    expect(
      getPrivateChatAutoAskQuestion({
        chatType: "private",
        text: "Pregunta",
        isBot: true,
      }),
    ).toBeUndefined();
  });

  it("returns undefined for blank text", () => {
    expect(
      getPrivateChatAutoAskQuestion({
        chatType: "private",
        text: "   ",
      }),
    ).toBeUndefined();
  });
});
