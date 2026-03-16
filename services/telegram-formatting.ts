

export type TelegramEntity =
  | { type: "bold"; offset: number; length: number }
  | { type: "italic"; offset: number; length: number }
  | {
      type: "custom_emoji";
      offset: number;
      length: number;
      custom_emoji_id: string;
    };

export interface TelegramFormattedText {
  text: string;
  entities: TelegramEntity[];
}

const GRAPHEME_SEGMENTER = new Intl.Segmenter("es", {
  granularity: "grapheme",
});
const EMOJI_LIKE_PATTERN = /[\p{Extended_Pictographic}\u200D\uFE0F\u20E3]/u;

function findNextMarker(source: string, marker: string, fromIndex: number): number {
  return source.indexOf(marker, fromIndex);
}

function shouldToggleMarker(
  source: string,
  marker: "*" | "**",
  index: number,
  isOpen: boolean,
): boolean {
  if (isOpen) {
    return true;
  }

  return findNextMarker(source, marker, index + marker.length) !== -1;
}

function buildCustomEmojiEntries(customEmojiMap: Record<string, string>) {
  return Object.entries(customEmojiMap)
    .filter(([emoji, id]) => emoji.trim() !== "" && id.trim() !== "")
    .sort(([leftEmoji], [rightEmoji]) => rightEmoji.length - leftEmoji.length);
}

function matchCustomEmoji(
  source: string,
  index: number,
  customEmojiEntries: Array<[string, string]>,
): [string, string] | undefined {
  return customEmojiEntries.find(([emoji]) => source.startsWith(emoji, index));
}

function sanitizeUnsupportedEmojis(
  source: string,
  customEmojiMap: Record<string, string>,
): string {
  const allowedEmojis = new Set(Object.keys(customEmojiMap));
  let sanitized = "";

  for (const { segment } of GRAPHEME_SEGMENTER.segment(source)) {
    if (allowedEmojis.has(segment) || !EMOJI_LIKE_PATTERN.test(segment)) {
      sanitized += segment;
    }
  }

  return sanitized;
}

export function buildTelegramFormattedText(
  source: string,
  customEmojiMap: Record<string, string> = {},
): TelegramFormattedText {
  const sanitizedSource = sanitizeUnsupportedEmojis(source, customEmojiMap);
  const customEmojiEntries = buildCustomEmojiEntries(customEmojiMap);
  const entities: TelegramEntity[] = [];
  let output = "";
  let index = 0;
  let boldOffset: number | undefined;
  let italicOffset: number | undefined;
  while (index < sanitizedSource.length) {
    if (
      sanitizedSource.startsWith("**", index) &&
      shouldToggleMarker(sanitizedSource, "**", index, boldOffset !== undefined)
    ) {
      if (boldOffset !== undefined) {
        const length = output.length - boldOffset;
        if (length > 0) {
          entities.push({
            type: "bold",
            offset: boldOffset,
            length,
          });
        }
        boldOffset = undefined;
      } else {
        boldOffset = output.length;
      }
      index += 2;
      continue;
    }

    if (
      sanitizedSource[index] === "*" &&
      shouldToggleMarker(sanitizedSource, "*", index, italicOffset !== undefined)
    ) {
      if (italicOffset !== undefined) {
        const length = output.length - italicOffset;
        if (length > 0) {
          entities.push({
            type: "italic",
            offset: italicOffset,
            length,
          });
        }
        italicOffset = undefined;
      } else {
        italicOffset = output.length;
      }
      index += 1;
      continue;
    }

    const customEmojiMatch = matchCustomEmoji(
      sanitizedSource,
      index,
      customEmojiEntries,
    );
    if (customEmojiMatch) {
      const [emoji, customEmojiId] = customEmojiMatch;
      const offset = output.length;
      output += emoji;
      entities.push({
        type: "custom_emoji",
        offset,
        length: emoji.length,
        custom_emoji_id: customEmojiId,
      });
      index += emoji.length;
      continue;
    }

    output += sanitizedSource[index];
    index += 1;
  }

  return {
    text: output,
    entities,
  };
}
