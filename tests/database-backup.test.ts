import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import {
  createDatabaseBackup,
  parseBackupHourUtc,
  shouldRunDailyBackup,
  startDatabaseBackupScheduler,
  uploadDatabaseBackup,
} from "../services/database-backup";
import { setupSchema } from "../services/sqlite";

describe("database backup", () => {
  const schedulers: Array<{ stop(): void }> = [];

  afterEach(() => {
    for (const scheduler of schedulers) {
      scheduler.stop();
    }
    schedulers.length = 0;
  });

  it("parses the UTC backup hour", () => {
    expect(parseBackupHourUtc(undefined)).toBe(3);
    expect(parseBackupHourUtc("")).toBe(3);
    expect(parseBackupHourUtc("0")).toBe(0);
    expect(parseBackupHourUtc("23")).toBe(23);
    expect(() => parseBackupHourUtc("24")).toThrow();
    expect(() => parseBackupHourUtc("noon")).toThrow();
  });

  it("runs once per UTC day after the configured hour", () => {
    const beforeHour = new Date("2026-09-05T02:59:00.000Z");
    const atHour = new Date("2026-09-05T03:00:00.000Z");
    const nextDay = new Date("2026-09-06T03:00:00.000Z");

    expect(
      shouldRunDailyBackup({
        now: beforeHour,
        hourUtc: 3,
      }),
    ).toBe(false);
    expect(
      shouldRunDailyBackup({
        now: atHour,
        hourUtc: 3,
      }),
    ).toBe(true);
    expect(
      shouldRunDailyBackup({
        now: atHour,
        hourUtc: 3,
        lastBackupDate: "2026-09-05",
      }),
    ).toBe(false);
    expect(
      shouldRunDailyBackup({
        now: nextDay,
        hourUtc: 3,
        lastBackupDate: "2026-09-05",
      }),
    ).toBe(true);
  });

  it("creates a gzip sqlite snapshot that can be restored", async () => {
    const db = new Database(":memory:");
    setupSchema(db);
    db.run(
      `INSERT INTO chat_pause_states (chat_id, status, paused_at)
       VALUES (42, 'paused', 1700000000)`,
    );

    const backup = await createDatabaseBackup(db, new Date("2026-09-05T12:00:00.000Z"));
    expect(backup.filename).toBe("veritheo-2026-09-05.sqlite.gz");
    expect(backup.contentType).toBe("application/gzip");
    expect(backup.caption).toContain("Date: 2026-09-05");

    const restoredPath = `/tmp/veritheo-backup-test-${Date.now()}.sqlite`;
    Bun.write(restoredPath, Bun.gunzipSync(backup.bytes));
    try {
      const restored = new Database(restoredPath, { readonly: true });
      const row = restored
        .query("SELECT chat_id, status FROM chat_pause_states WHERE chat_id = 42")
        .get() as { chat_id: number; status: string };
      expect(row).toEqual({ chat_id: 42, status: "paused" });
      restored.close();
    } finally {
      await Bun.file(restoredPath).unlink();
    }
  });

  it("uploads the backup document", async () => {
    const db = new Database(":memory:");
    setupSchema(db);
    const sent: Array<{ filename: string; caption?: string }> = [];

    const backup = await uploadDatabaseBackup({
      db,
      now: new Date("2026-09-05T12:00:00.000Z"),
      sendChannelDocument: async (document) => {
        sent.push({
          filename: document.filename,
          caption: document.caption,
        });
      },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.filename).toBe(backup.filename);
    expect(sent[0]?.caption).toBe(backup.caption);
  });

  it("sends a backup when the scheduler starts after the backup hour", async () => {
    const db = new Database(":memory:");
    setupSchema(db);
    let resolveSent: (value: string) => void = () => {};
    const sent = new Promise<string>((resolve) => {
      resolveSent = resolve;
    });

    const scheduler = startDatabaseBackupScheduler(db, {
      hourUtc: 3,
      checkIntervalMs: 10_000,
      now: () => new Date("2026-09-05T04:00:00.000Z"),
      sendChannelDocument: async (document) => {
        resolveSent(document.filename);
      },
    });
    schedulers.push(scheduler);

    await expect(sent).resolves.toBe("veritheo-2026-09-05.sqlite.gz");
  });
});
