type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractInlineText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => extractInlineText(item)).join("");
  }

  if (!isObject(value)) {
    return "";
  }

  const type = typeof value.type === "string" ? value.type : undefined;

  if (type === "url") {
    const label = extractInlineText(value.text);
    const url = typeof value.url === "string" ? value.url.trim() : "";
    if (label && url && label !== url) {
      return `${label} (${url})`;
    }
    return label || url;
  }

  if (type === "mention") {
    const label = extractInlineText(value.text);
    if (label) {
      return label;
    }
    const username =
      typeof value.username === "string" ? value.username.trim() : "";
    return username ? `@${username.replace(/^@/, "")}` : "";
  }

  if (type === "mathematical_expression") {
    return typeof value.expression === "string" ? value.expression : "";
  }

  if ("text" in value) {
    return extractInlineText(value.text);
  }

  if ("expression" in value && typeof value.expression === "string") {
    return value.expression;
  }

  return "";
}

function extractBlockText(block: unknown): string {
  if (!isObject(block)) {
    return typeof block === "string" ? block : "";
  }

  const type = typeof block.type === "string" ? block.type : undefined;

  if (type === "divider") {
    return "---";
  }

  if (type === "list") {
    const items = Array.isArray(block.items) ? block.items : [];
    return items
      .map((item, index) => {
        const itemBlocks = isObject(item) && Array.isArray(item.blocks)
          ? item.blocks
          : [item];
        const itemText = itemBlocks
          .map((itemBlock) => extractBlockText(itemBlock))
          .filter(Boolean)
          .join("\n");
        if (!itemText) {
          return "";
        }
        return itemText
          .split("\n")
          .map((line, lineIndex) =>
            lineIndex === 0 ? `${index + 1}. ${line}` : `   ${line}`,
          )
          .join("\n");
      })
      .filter(Boolean)
      .join("\n");
  }

  if (type === "table") {
    const rows = Array.isArray(block.rows) ? block.rows : [];
    return rows
      .map((row) => {
        const cells = isObject(row) && Array.isArray(row.cells)
          ? row.cells
          : Array.isArray(row)
            ? row
            : [];
        return cells
          .map((cell) => {
            if (isObject(cell) && Array.isArray(cell.blocks)) {
              return cell.blocks
                .map((cellBlock) => extractBlockText(cellBlock))
                .filter(Boolean)
                .join(" ");
            }
            return extractInlineText(cell);
          })
          .filter(Boolean)
          .join(" | ");
      })
      .filter(Boolean)
      .join("\n");
  }

  if (type === "blockquote" || type === "heading" || type === "paragraph") {
    return extractInlineText(block.text ?? block.blocks);
  }

  if (Array.isArray(block.blocks)) {
    return block.blocks
      .map((nested) => extractBlockText(nested))
      .filter(Boolean)
      .join("\n");
  }

  if ("text" in block) {
    return extractInlineText(block.text);
  }

  return "";
}

export function extractTextFromRichMessage(
  richMessage: unknown,
): string | undefined {
  if (!isObject(richMessage)) {
    return undefined;
  }

  const blocks = Array.isArray(richMessage.blocks) ? richMessage.blocks : [];
  if (blocks.length === 0) {
    const fallback = extractInlineText(richMessage);
    const normalizedFallback = normalizeWhitespace(fallback);
    return normalizedFallback || undefined;
  }

  const text = normalizeWhitespace(
    blocks
      .map((block) => extractBlockText(block))
      .filter(Boolean)
      .join("\n\n"),
  );

  return text || undefined;
}

export function getMessagePlainText(message?: {
  text?: unknown;
  caption?: unknown;
  rich_message?: unknown;
}): string | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  if (typeof message.text === "string" && message.text.trim() !== "") {
    return message.text;
  }

  if (typeof message.caption === "string" && message.caption.trim() !== "") {
    return message.caption;
  }

  return extractTextFromRichMessage(message.rich_message);
}
