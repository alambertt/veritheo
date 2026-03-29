import { Database } from "bun:sqlite";
import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  buildTelegramMessageRecord,
  claimNextBroadcastDelivery,
  claimNextBroadcastJob,
  completeBroadcastJob,
  enqueueBroadcastJob,
  getBroadcastJobById,
  getBroadcastTargetChats,
  listBroadcastDeliveriesForJob,
  markBroadcastDeliveryDone,
  markBroadcastDeliveryFailed,
  requeueStuckBroadcastJobs,
  setupSchema,
  storeTelegramMessage,
} from "../services/sqlite";

describe("broadcast sqlite queue", () => {
  const db = new Database(":memory:");

  beforeAll(() => {
    setupSchema(db);
  });

  beforeEach(() => {
    db.run("DELETE FROM broadcast_deliveries");
    db.run("DELETE FROM broadcast_jobs");
    db.run("DELETE FROM messages");
  });

  it("returns distinct target chats using the latest stored chat snapshot", () => {
    storeTelegramMessage(
      db,
      buildTelegramMessageRecord({
        message_id: 1,
        chat: { id: 10, type: "group", title: "Old title" },
        date: 1_700_000_000,
        text: "first",
      }),
    );
    storeTelegramMessage(
      db,
      buildTelegramMessageRecord({
        message_id: 2,
        chat: { id: 10, type: "supergroup", title: "New title" },
        date: 1_700_000_001,
        text: "second",
      }),
    );
    storeTelegramMessage(
      db,
      buildTelegramMessageRecord({
        message_id: 3,
        chat: { id: 20, type: "private", username: "owner" },
        date: 1_700_000_002,
        text: "third",
      }),
    );

    expect(getBroadcastTargetChats(db)).toEqual([
      {
        chat_id: 10,
        chat_type: "supergroup",
        chat_title: "New title",
        chat_username: undefined,
      },
      {
        chat_id: 20,
        chat_type: "private",
        chat_title: undefined,
        chat_username: "owner",
      },
    ]);
  });

  it("creates a broadcast job with pending per-chat deliveries", () => {
    const job = enqueueBroadcastJob(db, {
      ownerChatId: 738668189,
      ownerUserId: 738668189,
      message: "Hello flock",
      targets: [
        { chat_id: 1, chat_type: "private" },
        { chat_id: 2, chat_type: "group", chat_title: "Group" },
      ],
    });

    expect(job.total_count).toBe(2);
    expect(job.status).toBe("pending");
    expect(listBroadcastDeliveriesForJob(db, job.id)).toEqual([
      expect.objectContaining({ chat_id: 1, status: "pending" }),
      expect.objectContaining({ chat_id: 2, status: "pending" }),
    ]);
  });

  it("tracks delivery outcomes and rolls job counts up on completion", () => {
    const job = enqueueBroadcastJob(db, {
      ownerChatId: 738668189,
      ownerUserId: 738668189,
      message: "Broadcast",
      targets: [
        { chat_id: 10, chat_type: "private" },
        { chat_id: 20, chat_type: "group" },
      ],
    });

    const claimedJob = claimNextBroadcastJob(db);
    expect(claimedJob?.id).toBe(job.id);
    expect(claimedJob?.status).toBe("processing");

    const firstDelivery = claimNextBroadcastDelivery(db, job.id);
    expect(firstDelivery?.chat_id).toBe(10);
    markBroadcastDeliveryDone(db, {
      deliveryId: firstDelivery!.id,
      sentMessageId: 99,
    });

    const secondDelivery = claimNextBroadcastDelivery(db, job.id);
    expect(secondDelivery?.chat_id).toBe(20);
    markBroadcastDeliveryFailed(db, {
      deliveryId: secondDelivery!.id,
      error: "Forbidden: bot was blocked by the user",
    });

    expect(completeBroadcastJob(db, job.id)).toEqual({
      total_count: 2,
      sent_count: 1,
      failed_count: 1,
    });

    expect(getBroadcastJobById(db, job.id)).toEqual(
      expect.objectContaining({
        status: "done",
        total_count: 2,
        sent_count: 1,
        failed_count: 1,
      }),
    );
  });

  it("requeues stuck processing jobs and deliveries", () => {
    const job = enqueueBroadcastJob(db, {
      ownerChatId: 738668189,
      ownerUserId: 738668189,
      message: "Retry me",
      targets: [{ chat_id: 123, chat_type: "group" }],
    });

    expect(claimNextBroadcastJob(db)?.status).toBe("processing");
    expect(claimNextBroadcastDelivery(db, job.id)?.status).toBe("processing");

    expect(requeueStuckBroadcastJobs(db)).toBe(2);

    expect(getBroadcastJobById(db, job.id)?.status).toBe("pending");
    expect(listBroadcastDeliveriesForJob(db, job.id)[0]?.status).toBe("pending");
  });
});
