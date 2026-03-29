import type { ChatPauseState } from "./sqlite";

const COMPACT_DURATION_PATTERN = /^(\d+)([mhd])$/i;

export const CONTROL_COMMANDS = new Set([
  "veritheo_pause",
  "veritheo_resume",
  "veritheo_status",
]);

export const ALLOWED_COMMANDS_WHILE_PAUSED = new Set([
  ...CONTROL_COMMANDS,
  "help",
  "start",
  "ping",
  "veritheo_broadcast",
]);

export function isGroupChatType(chatType?: string): boolean {
  return chatType === "group" || chatType === "supergroup";
}

export function parseCompactDuration(input: string): number | undefined {
  const match = input.trim().match(COMPACT_DURATION_PATTERN);
  if (!match) {
    return undefined;
  }

  const value = Number(match[1]);
  if (!Number.isSafeInteger(value) || value <= 0) {
    return undefined;
  }

  const unit = (match[2] ?? "").toLowerCase();
  const multiplier = unit === "m" ? 60 : unit === "h" ? 60 * 60 : 24 * 60 * 60;
  return value * multiplier;
}

export function getCommandName(text?: string): string | undefined {
  if (!text) {
    return undefined;
  }

  const token = text.trim().split(/\s+/, 1)[0];
  if (!token?.startsWith("/")) {
    return undefined;
  }

  const command = token.slice(1).split("@")[0]?.trim().toLowerCase();
  return command || undefined;
}

export function getCommandArgs(text?: string): string {
  const trimmed = text?.trim() ?? "";
  const firstSpaceIndex = trimmed.indexOf(" ");
  if (firstSpaceIndex === -1) {
    return "";
  }

  return trimmed.slice(firstSpaceIndex + 1).trim();
}

export function parsePauseCommandArgs(argsText?: string): {
  durationSeconds?: number;
  reason?: string;
} {
  const trimmed = argsText?.trim() ?? "";
  if (trimmed === "") {
    return {};
  }

  const [firstToken, ...restTokens] = trimmed.split(/\s+/);
  const durationSeconds = parseCompactDuration(firstToken ?? "");

  if (durationSeconds === undefined) {
    return {
      reason: trimmed,
    };
  }

  const reason = restTokens.join(" ").trim();
  return {
    durationSeconds,
    reason: reason || undefined,
  };
}

function formatPauseTimestamp(timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 16)
    .concat(" UTC");
}

function formatRemainingDuration(seconds: number): string {
  if (seconds <= 0) {
    return "0m";
  }

  const days = Math.floor(seconds / (24 * 60 * 60));
  const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.ceil((seconds % (60 * 60)) / 60);
  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days}d`);
  }

  if (hours > 0) {
    parts.push(`${hours}h`);
  }

  if (minutes > 0 && parts.length < 2) {
    parts.push(`${minutes}m`);
  }

  return parts.join(" ");
}

export function formatPauseStatusMessage(
  pauseState: ChatPauseState | undefined,
  now = Math.floor(Date.now() / 1000),
): string {
  if (!pauseState?.is_active) {
    return "▶️ Veritheo está activo en este grupo.";
  }

  if (typeof pauseState.paused_until === "number") {
    const remainingSeconds = Math.max(0, pauseState.paused_until - now);
    const remainingText = formatRemainingDuration(remainingSeconds);
    const reasonText = pauseState.reason
      ? ` Motivo: ${pauseState.reason}`
      : "";
    return `⏸️ Veritheo está en pausa hasta ${formatPauseTimestamp(pauseState.paused_until)} (${remainingText} restantes).${reasonText}`;
  }

  const reasonText = pauseState.reason ? ` Motivo: ${pauseState.reason}` : "";
  return `⏸️ Veritheo está en pausa indefinida.${reasonText}`;
}

export function shouldBlockActivityWhilePaused(params: {
  chatType?: string;
  isPaused: boolean;
  commandName?: string;
}): boolean {
  if (!params.isPaused || !isGroupChatType(params.chatType)) {
    return false;
  }

  if (!params.commandName) {
    return true;
  }

  return !ALLOWED_COMMANDS_WHILE_PAUSED.has(params.commandName);
}
