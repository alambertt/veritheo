import { describe, expect, it } from "bun:test";
import { getGroupMentionAutoAskQuestion } from "../services/group-mention-auto-ask";

describe("getGroupMentionAutoAskQuestion", () => {
  it("returns the message without the bot mention in groups", () => {
    expect(
      getGroupMentionAutoAskQuestion({
        chatType: "group",
        text: "@Veritheo ¿Cuándo es Pentecostés?",
        botUsername: "veritheo",
        entities: [{ type: "mention", offset: 0, length: 10 }],
      }),
    ).toBe("¿Cuándo es Pentecostés?");
  });

  it("matches mentions case-insensitively and preserves the rest of the question", () => {
    expect(
      getGroupMentionAutoAskQuestion({
        chatType: "supergroup",
        text: "Oye @VERITHEO qué opinas de Nicea",
        botUsername: "veritheo",
        entities: [{ type: "mention", offset: 4, length: 10 }],
      }),
    ).toBe("Oye qué opinas de Nicea");
  });

  it("returns undefined when the bot is not mentioned", () => {
    expect(
      getGroupMentionAutoAskQuestion({
        chatType: "group",
        text: "@otrobot responde esto",
        botUsername: "veritheo",
        entities: [{ type: "mention", offset: 0, length: 8 }],
      }),
    ).toBeUndefined();
  });

  it("returns undefined for private chats, commands, bots, banned users, and blank questions", () => {
    expect(
      getGroupMentionAutoAskQuestion({
        chatType: "private",
        text: "@veritheo pregunta",
        botUsername: "veritheo",
        entities: [{ type: "mention", offset: 0, length: 10 }],
      }),
    ).toBeUndefined();

    expect(
      getGroupMentionAutoAskQuestion({
        chatType: "group",
        text: "/ask_group pregunta",
        botUsername: "veritheo",
        entities: [],
        isCommand: true,
      }),
    ).toBeUndefined();

    expect(
      getGroupMentionAutoAskQuestion({
        chatType: "group",
        text: "@veritheo pregunta",
        botUsername: "veritheo",
        entities: [{ type: "mention", offset: 0, length: 10 }],
        isBot: true,
      }),
    ).toBeUndefined();

    expect(
      getGroupMentionAutoAskQuestion({
        chatType: "group",
        text: "@veritheo pregunta",
        botUsername: "veritheo",
        entities: [{ type: "mention", offset: 0, length: 10 }],
        userId: 7,
        bannedUserIds: [7],
      }),
    ).toBeUndefined();

    expect(
      getGroupMentionAutoAskQuestion({
        chatType: "group",
        text: "@veritheo",
        botUsername: "veritheo",
        entities: [{ type: "mention", offset: 0, length: 10 }],
      }),
    ).toBeUndefined();
  });
});
