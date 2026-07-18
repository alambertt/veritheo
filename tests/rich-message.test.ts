import { describe, expect, it } from "bun:test";
import {
  extractTextFromRichMessage,
  getMessagePlainText,
} from "../services/rich-message";
import {
  buildTelegramMessageRecord,
  mapToTelegramRawMessage,
} from "../services/sqlite";

describe("rich message text extraction", () => {
  it("extracts paragraphs, emphasis, lists and links", () => {
    const text = extractTextFromRichMessage({
      blocks: [
        {
          type: "heading",
          text: "Justificación",
          size: 1,
        },
        {
          type: "paragraph",
          text: [
            "El ",
            { type: "bold", text: "Evangelio" },
            " afirma la ",
            { type: "italic", text: "sustitución" },
            ".",
          ],
        },
        {
          type: "list",
          items: [
            {
              blocks: [
                {
                  type: "paragraph",
                  text: "Primer punto",
                },
              ],
            },
            {
              blocks: [
                {
                  type: "paragraph",
                  text: [
                    "Ver ",
                    {
                      type: "url",
                      text: "fuente",
                      url: "https://example.com",
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "divider",
        },
        {
          type: "blockquote",
          text: "Una cita relevante",
        },
      ],
    });

    expect(text).toBe(
      [
        "Justificación",
        "",
        "El Evangelio afirma la sustitución.",
        "",
        "1. Primer punto",
        "2. Ver fuente (https://example.com)",
        "",
        "---",
        "",
        "Una cita relevante",
      ].join("\n"),
    );
  });

  it("prefers plain text over rich_message when both exist", () => {
    expect(
      getMessagePlainText({
        text: "Texto plano",
        rich_message: {
          blocks: [{ type: "paragraph", text: "Texto rico" }],
        },
      }),
    ).toBe("Texto plano");
  });

  it("falls back to rich_message when text and caption are missing", () => {
    expect(
      getMessagePlainText({
        rich_message: {
          blocks: [
            {
              type: "paragraph",
              text: "Solo contenido enriquecido",
            },
          ],
        },
      }),
    ).toBe("Solo contenido enriquecido");
  });

  it("maps Telegram rich_message messages into stored text", () => {
    const mapped = mapToTelegramRawMessage({
      message_id: 42,
      date: 1_700_000_000,
      chat: { id: 7, type: "supergroup", title: "Grupo" },
      from: { id: 9, is_bot: false, first_name: "Ana" },
      rich_message: {
        blocks: [
          {
            type: "paragraph",
            text: [
              "Cuando un cristiano afirma que ",
              { type: "bold", text: "Cristo es nuestro descanso" },
              ".",
            ],
          },
        ],
      },
    } as any);

    const record = buildTelegramMessageRecord(mapped);
    expect(record.text).toBe(
      "Cuando un cristiano afirma que Cristo es nuestro descanso.",
    );
  });
});
