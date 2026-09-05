import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import type { Database } from "bun:sqlite";
import type { ChannelDocument } from "./channel-logs";

export const DEFAULT_DATABASE_BACKUP_HOUR_UTC = 3;
export const DEFAULT_DATABASE_BACKUP_CHECK_INTERVAL_MS = 60_000;
export const DATABASE_BACKUP_RETRY_DELAY_MS = 15 * 60 * 1000;
export const TELEGRAM_DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;

export type DatabaseBackup = ChannelDocument & {
  date: string;
  originalBytes: number;
  compressedBytes: number;
};

export function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseBackupHourUtc(raw?: string): number {
  if (!raw || raw.trim() === "") {
    return DEFAULT_DATABASE_BACKUP_HOUR_UTC;
  }

  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) {
    throw new Error(
      `Invalid DATABASE_BACKUP_HOUR_UTC environment variable: "${raw}" must be an integer from 0 to 23`,
    );
  }

  return parsed;
}

export function shouldRunDailyBackup(params: {
  now: Date;
  hourUtc: number;
  lastBackupDate?: string;
}): boolean {
  if (params.now.getUTCHours() < params.hourUtc) {
    return false;
  }

  return params.lastBackupDate !== utcDateKey(params.now);
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sqliteStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function gzipFile(sourcePath: string, destinationPath: string) {
  await pipeline(
    createReadStream(sourcePath),
    createGzip(),
    createWriteStream(destinationPath),
  );
}

export async function createDatabaseBackup(
  db: Database,
  now = new Date(),
): Promise<DatabaseBackup> {
  const date = utcDateKey(now);
  const filename = `veritheo-${date}.sqlite.gz`;
  const workDir = await mkdtemp(join(tmpdir(), "veritheo-backup-"));
  const snapshotPath = join(workDir, `veritheo-${date}.sqlite`);
  const gzipPath = join(workDir, filename);

  try {
    db.run(`VACUUM INTO ${sqliteStringLiteral(snapshotPath)}`);
    await gzipFile(snapshotPath, gzipPath);

    const snapshotFile = Bun.file(snapshotPath);
    const gzipFileHandle = Bun.file(gzipPath);
    const originalBytes = snapshotFile.size;
    const compressedBytes = gzipFileHandle.size;
    if (compressedBytes > TELEGRAM_DOCUMENT_MAX_BYTES) {
      throw new Error(
        `Database backup is larger than the Telegram 50 MB limit (${compressedBytes} bytes)`,
      );
    }

    const bytes = new Uint8Array(await gzipFileHandle.arrayBuffer());
    return {
      date,
      filename,
      bytes,
      contentType: "application/gzip",
      originalBytes,
      compressedBytes,
      caption: [
        "📦 Daily database backup",
        `Date: ${date}`,
        `OriginalSize: ${formatByteSize(originalBytes)}`,
        `CompressedSize: ${formatByteSize(compressedBytes)}`,
      ].join("\n"),
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function uploadDatabaseBackup(params: {
  db: Database;
  now?: Date;
  sendChannelDocument: (document: ChannelDocument) => Promise<void>;
}): Promise<DatabaseBackup> {
  const backup = await createDatabaseBackup(params.db, params.now);

  await params.sendChannelDocument(backup);
  return backup;
}

type BackupSchedulerOptions = {
  hourUtc?: number;
  checkIntervalMs?: number;
  now?: () => Date;
  sendChannelDocument: (document: ChannelDocument) => Promise<void>;
  onError?: (context: string, error: unknown) => Promise<void> | void;
};

export function startDatabaseBackupScheduler(
  db: Database,
  options: BackupSchedulerOptions,
) {
  const hourUtc = options.hourUtc ?? DEFAULT_DATABASE_BACKUP_HOUR_UTC;
  const checkIntervalMs =
    options.checkIntervalMs ?? DEFAULT_DATABASE_BACKUP_CHECK_INTERVAL_MS;
  let lastBackupDate: string | undefined;
  let nextRetryAt = 0;
  let running = false;
  let stopped = false;

  const tick = async () => {
    if (stopped || running) {
      return;
    }

    const now = options.now?.() ?? new Date();
    if (Date.now() < nextRetryAt) {
      return;
    }
    if (
      !shouldRunDailyBackup({
        now,
        hourUtc,
        lastBackupDate,
      })
    ) {
      return;
    }

    running = true;
    try {
      const backup = await uploadDatabaseBackup({
        db,
        now,
        sendChannelDocument: options.sendChannelDocument,
      });
      lastBackupDate = backup.date;
      nextRetryAt = 0;
    } catch (error) {
      nextRetryAt = Date.now() + DATABASE_BACKUP_RETRY_DELAY_MS;
      if (options.onError) {
        await options.onError("Failed to upload daily database backup", error);
      } else {
        console.error("Failed to upload daily database backup:", error);
      }
    } finally {
      running = false;
    }
  };

  const interval = setInterval(() => {
    void tick();
  }, checkIntervalMs);

  void tick();

  return {
    stop() {
      stopped = true;
      clearInterval(interval);
    },
  };
}
