import { describe, expect, it } from "bun:test";
import {
  BROADCAST_OWNER_USER_ID,
  buildBroadcastAcceptedMessage,
  buildBroadcastCompletionMessage,
  getBroadcastMessage,
  isOwnerBroadcastCommandAllowed,
} from "../services/broadcast";

describe("broadcast helpers", () => {
  it("extracts the broadcast message body", () => {
    expect(getBroadcastMessage("/veritheo_broadcast Hello world")).toBe(
      "Hello world",
    );
    expect(getBroadcastMessage("/veritheo_broadcast   [link](https://x.com)  ")).toBe(
      "[link](https://x.com)",
    );
  });

  it("normalizes escaped newlines in broadcast messages", () => {
    expect(
      getBroadcastMessage("/veritheo_broadcast Línea 1\\n\\nLínea 2"),
    ).toBe("Línea 1\n\nLínea 2");
  });

  it("returns undefined when no broadcast message is provided", () => {
    expect(getBroadcastMessage("/veritheo_broadcast")).toBeUndefined();
    expect(getBroadcastMessage("/veritheo_broadcast   ")).toBeUndefined();
  });

  it("allows only the owner in private chats", () => {
    expect(
      isOwnerBroadcastCommandAllowed({
        chatType: "private",
        userId: BROADCAST_OWNER_USER_ID,
      }),
    ).toBe(true);

    expect(
      isOwnerBroadcastCommandAllowed({
        chatType: "group",
        userId: BROADCAST_OWNER_USER_ID,
      }),
    ).toBe(false);

    expect(
      isOwnerBroadcastCommandAllowed({
        chatType: "private",
        userId: 123,
      }),
    ).toBe(false);
  });

  it("builds concise accepted and completion messages", () => {
    expect(buildBroadcastAcceptedMessage(3)).toContain("3");
    expect(
      buildBroadcastCompletionMessage({
        totalCount: 5,
        sentCount: 4,
        failedCount: 1,
      }),
    ).toContain("Fallidos: 1");
  });
});
