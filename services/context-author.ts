import { formatDisplayName } from "./channel-logs";

export type ContextAuthor = {
  from_is_bot?: boolean;
  from_first_name?: string;
  from_last_name?: string;
  from_username?: string;
};

// Telegram sends anonymous group admins as this bot account; they are real people.
const ANONYMOUS_ADMIN_USERNAME = "groupanonymousbot";

export const toContextAuthor = (from?: {
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}): ContextAuthor => ({
  from_is_bot: from?.is_bot,
  from_first_name: from?.first_name,
  from_last_name: from?.last_name,
  from_username: from?.username,
});

/**
 * Sender label for a context line, so the model can tell users apart.
 * Returns undefined for other bots: only real users and Veritheo itself are kept.
 */
export function formatContextAuthor(
  author: ContextAuthor,
  botUsernames: string[],
): string | undefined {
  const username = author.from_username?.toLowerCase();
  if (author.from_is_bot) {
    if (username && botUsernames.some((name) => name.toLowerCase() === username)) {
      return "Veritheo";
    }
    if (username === ANONYMOUS_ADMIN_USERNAME) {
      return "Admin anónimo";
    }
    return undefined;
  }

  const name = formatDisplayName([author.from_first_name, author.from_last_name]);
  const handle = author.from_username ? `@${author.from_username}` : undefined;
  if (name && handle) {
    return `${name} (${handle})`;
  }
  return name ?? handle ?? "Usuario";
}

export function buildContextEntry(
  message: ContextAuthor & { text?: string },
  botUsernames: string[],
): string | undefined {
  const text = message.text?.trim();
  const author = formatContextAuthor(message, botUsernames);
  return text && author ? `${author}: ${text}` : undefined;
}
