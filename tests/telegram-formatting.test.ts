import { describe, expect, it } from "bun:test";
import { TELEGRAM_CUSTOM_EMOJI_MAP } from "../constants";
import { buildTelegramFormattedText } from "../services/telegram-formatting";

describe("telegram formatting", () => {
  it("converts bold, italic and custom emojis into Telegram entities", () => {
    const result = buildTelegramFormattedText("Hola **mundo** 🙏 y *paz*", {
      "🙏": "123456",
    });

    expect(result.text).toBe("Hola mundo 🙏 y paz");
    expect(result.entities).toEqual([
      {
        type: "bold",
        offset: 5,
        length: 5,
      },
      {
        type: "custom_emoji",
        offset: 11,
        length: "🙏".length,
        custom_emoji_id: "123456",
      },
      {
        type: "italic",
        offset: 16,
        length: 3,
      },
    ]);
  });

  it("preserves unmatched markdown markers as literal text", () => {
    const result = buildTelegramFormattedText("Texto con *asterisco suelto");

    expect(result.text).toBe("Texto con *asterisco suelto");
    expect(result.entities).toEqual([]);
  });

  it("converts markdown links into Telegram text_link entities", () => {
    const result = buildTelegramFormattedText(
      "Lee [esta fuente](https://example.com/docs) ahora",
    );

    expect(result.text).toBe("Lee esta fuente ahora");
    expect(result.entities).toEqual([
      {
        type: "text_link",
        offset: 4,
        length: "esta fuente".length,
        url: "https://example.com/docs",
      },
    ]);
  });

  it("supports citation-style markdown links like [[1]](url)", () => {
    const result = buildTelegramFormattedText(
      "Cita [[1]](https://example.com/ref) aquí",
    );

    expect(result.text).toBe("Cita [1] aquí");
    expect(result.entities).toEqual([
      {
        type: "text_link",
        offset: 5,
        length: "[1]".length,
        url: "https://example.com/ref",
      },
    ]);
  });

  it("preserves malformed markdown links as literal text", () => {
    const result = buildTelegramFormattedText(
      "Texto con [link roto](https://example.com",
    );

    expect(result.text).toBe("Texto con [link roto](https://example.com");
    expect(result.entities).toEqual([]);
  });

  it("filters out emojis that are not in the premium mapping", () => {
    const result = buildTelegramFormattedText("Hola 🙂 🤡 mundo ✨", {
      "🤡": "123",
      "✨": "456",
    });

    expect(result.text).toBe("Hola  🤡 mundo ✨");
    expect(result.entities).toEqual([
      {
        type: "custom_emoji",
        offset: 6,
        length: "🤡".length,
        custom_emoji_id: "123",
      },
      {
        type: "custom_emoji",
        offset: 15,
        length: "✨".length,
        custom_emoji_id: "456",
      },
    ]);
  });

  it("exposes the checked-in premium emoji mapping", () => {
    expect(TELEGRAM_CUSTOM_EMOJI_MAP["🤡"]).toBe("5316602649779384632");
    expect(TELEGRAM_CUSTOM_EMOJI_MAP["🏓"]).toBe("5269563867305879894");
  });
});
