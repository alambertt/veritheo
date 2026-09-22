const SENSITIVE_NAME =
  /(?:TOKEN|API[_-]?KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTHORIZATION|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|COOKIE|CONNECTION[_-]?STRING|DATABASE[_-]?URL|(?:DB|REDIS|MONGO)[_-]?(?:URL|URI)|DSN)/i;

const SENSITIVE_FIELD =
  /(?:TOKEN|API[_-]?KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTHORIZATION|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|COOKIE|CONNECTION[_-]?STRING|DATABASE[_-]?URL|(?:DB|REDIS|MONGO)[_-]?(?:URL|URI)|DSN)/i;

export function redactSecrets(text: string): string {
  const secrets = Object.entries(process.env)
    .filter(([name, value]) => SENSITIVE_NAME.test(name) && Boolean(value))
    .map(([, value]) => value!)
    .sort((left, right) => right.length - left.length);

  let safeText = text;
  for (const secret of secrets) {
    safeText = safeText.replaceAll(secret, "[REDACTED]");
  }

  return safeText
    .replace(
      /(authorization\s*["']?\s*[:=]\s*["']?\s*)(?:(?:bearer|basic|token)\s+)?[^"'\s,}&]+/gi,
      "$1[REDACTED]",
    )
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_TELEGRAM_TOKEN]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,})\b/g, "[REDACTED_API_KEY]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]")
    .replace(
      /((?:api[_-]?key|access[_-]?key|client[_-]?secret|refresh[_-]?token|token|secret|password)\s*["']?\s*[:=]\s*["']?)[^"'\s,}&]+/gi,
      "$1[REDACTED]",
    );
}

export function formatErrorForLog(error: unknown): string {
  let details: string;
  if (error instanceof Error) {
    const stack = error.stack ? `\nStack:\n${error.stack}` : "";
    details = `${error.name}: ${error.message}${stack}`;
  } else if (typeof error === "string") {
    details = error;
  } else {
    try {
      details = JSON.stringify(error, null, 2) ?? String(error);
    } catch {
      details = String(error);
    }
  }

  return redactSecrets(details);
}

export function sanitizeLogArgument(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): unknown {
  if (typeof value === "string") {
    return redactSecrets(value);
  }
  if (value instanceof Error) {
    return formatErrorForLog(value);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (depth >= 6) {
    return "[Max log depth]";
  }
  if (seen.has(value)) {
    return "[Circular]";
  }

  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogArgument(item, seen, depth + 1));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_FIELD.test(key)
        ? "[REDACTED]"
        : sanitizeLogArgument(item, seen, depth + 1),
    ]),
  );
}

const CONSOLE_LEVELS = [
  "log",
  "info",
  "warn",
  "error",
  "debug",
  "dir",
  "table",
  "trace",
] as const;
let consoleRedactionInstalled = false;

export function installConsoleRedaction(): void {
  if (consoleRedactionInstalled) {
    return;
  }

  for (const level of CONSOLE_LEVELS) {
    const original = console[level].bind(console) as (...args: unknown[]) => void;
    Object.defineProperty(console, level, {
      configurable: true,
      value: (...args: unknown[]) =>
        original(
          ...args.map((argument) => {
            try {
              return sanitizeLogArgument(argument);
            } catch {
              return "[Log value omitted]";
            }
          }),
        ),
    });
  }

  consoleRedactionInstalled = true;
}
