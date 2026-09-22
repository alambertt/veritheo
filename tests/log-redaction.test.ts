import { expect, test } from "bun:test";
import {
  formatErrorForLog,
  redactSecrets,
  sanitizeLogArgument,
} from "../services/log-redaction";

test("redacts environment secrets and common credential formats", () => {
  const envName = "LOG_REDACTION_TEST_TOKEN";
  const previousValue = process.env[envName];
  const envSecret = "test-secret-value-for-redaction";
  process.env[envName] = envSecret;

  try {
    const text = redactSecrets(
      `env=${envSecret} Bearer bearer-secret-value token=field-secret-value 123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstu sk-test-abcdefghijklmnopqrstuvwxyz123456`,
    );

    expect(text).not.toContain(envSecret);
    expect(text).not.toContain("bearer-secret-value");
    expect(text).not.toContain("field-secret-value");
    expect(text).not.toContain("123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    expect(text).not.toContain("sk-test-abcdefghijklmnopqrstuvwxyz123456");
    expect(text).toContain("[REDACTED_TELEGRAM_TOKEN]");
    expect(text).toContain("[REDACTED_API_KEY]");
  } finally {
    if (previousValue === undefined) {
      delete process.env[envName];
    } else {
      process.env[envName] = previousValue;
    }
  }
});

test("redacts short values from sensitive environment variables", () => {
  const envName = "TEST_API_SECRET";
  const previousValue = process.env[envName];
  process.env[envName] = "abc";

  try {
    expect(redactSecrets("credential=abc")).toBe("credential=[REDACTED]");
  } finally {
    if (previousValue === undefined) {
      delete process.env[envName];
    } else {
      process.env[envName] = previousValue;
    }
  }
});

test("redacts secrets in structured log fields and errors", () => {
  const result = sanitizeLogArgument({
    apiKey: "structured-secret-value",
    message: "Authorization: Bearer header-secret-value",
  });
  const safeError = formatErrorForLog(
    new Error("request failed with token=error-secret-value"),
  );

  expect(result).toEqual({
    apiKey: "[REDACTED]",
    message: "Authorization: [REDACTED]",
  });
  expect(safeError).not.toContain("error-secret-value");
});
