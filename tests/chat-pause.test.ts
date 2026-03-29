import { describe, expect, it } from "bun:test";
import {
  formatPauseStatusMessage,
  parseCompactDuration,
  parsePauseCommandArgs,
  shouldBlockActivityWhilePaused,
} from "../services/chat-pause";

describe("chat pause helpers", () => {
  describe("parseCompactDuration", () => {
    it("parses compact minute, hour, and day durations", () => {
      expect(parseCompactDuration("15m")).toBe(15 * 60);
      expect(parseCompactDuration("2h")).toBe(2 * 60 * 60);
      expect(parseCompactDuration("1d")).toBe(24 * 60 * 60);
    });

    it("rejects invalid duration tokens", () => {
      expect(parseCompactDuration("0m")).toBeUndefined();
      expect(parseCompactDuration("15min")).toBeUndefined();
      expect(parseCompactDuration("abc")).toBeUndefined();
    });
  });

  describe("parsePauseCommandArgs", () => {
    it("parses duration with an optional reason", () => {
      expect(parsePauseCommandArgs("2h maintenance")).toEqual({
        durationSeconds: 2 * 60 * 60,
        reason: "maintenance",
      });
    });

    it("treats non-duration first args as an indefinite pause reason", () => {
      expect(parsePauseCommandArgs("cleanup in progress")).toEqual({
        reason: "cleanup in progress",
      });
    });

    it("allows an indefinite pause with no arguments", () => {
      expect(parsePauseCommandArgs("")).toEqual({});
    });
  });

  describe("shouldBlockActivityWhilePaused", () => {
    it("blocks normal messages and work commands in paused groups", () => {
      expect(
        shouldBlockActivityWhilePaused({
          chatType: "group",
          isPaused: true,
        }),
      ).toBe(true);

      expect(
        shouldBlockActivityWhilePaused({
          chatType: "group",
          isPaused: true,
          commandName: "verify",
        }),
      ).toBe(true);
    });

    it("allows control and lightweight commands while paused", () => {
      expect(
        shouldBlockActivityWhilePaused({
          chatType: "supergroup",
          isPaused: true,
          commandName: "veritheo_status",
        }),
      ).toBe(false);

      expect(
        shouldBlockActivityWhilePaused({
          chatType: "supergroup",
          isPaused: true,
          commandName: "help",
        }),
      ).toBe(false);
    });

    it("does not block private chats", () => {
      expect(
        shouldBlockActivityWhilePaused({
          chatType: "private",
          isPaused: true,
          commandName: "verify",
        }),
      ).toBe(false);
    });
  });

  describe("formatPauseStatusMessage", () => {
    it("includes remaining time and reason for temporary pauses", () => {
      expect(
        formatPauseStatusMessage(
          {
            chat_id: 1,
            status: "paused",
            paused_at: 1_700_000_000,
            paused_until: 1_700_003_600,
            reason: "maintenance",
            is_active: true,
          },
          1_700_000_000,
        ),
      ).toContain("maintenance");
    });
  });
});
