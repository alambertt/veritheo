import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { classifyRoastMessage } from "../services/roast-preflight";
import {
  buildRoastPolicyInstruction,
} from "../services/roast-preflight";
import {
  resetTypeSafeClientForTests,
  setTypeSafeSystemOneForTests,
  type TypeSafeSystemOne,
} from "../services/typesafe";
import {
  findSimilarBotMessageInChatWithJudgment,
} from "../services/self-message-guard";
import { selectHeresyMessages } from "../services/heresy";
import {
  selectVerifyClaims,
  splitVerifyClaimCandidates,
} from "../services/verify";
import {
  validateTheologyQuizPollSemantics,
  type TheologyQuizPoll,
} from "../services/theology-poll";
import { rankGroupContextMessages } from "../services/group-context-ranking";
import { setupSchema } from "../services/sqlite";

const FEATURE_ENV_NAMES = [
  "TYPESAFE_SELF_MESSAGE_GUARD",
  "TYPESAFE_ROAST_PREFLIGHT",
  "TYPESAFE_HERESY_SELECTION",
  "TYPESAFE_THEOLOGY_POLL_VALIDATION",
  "TYPESAFE_VERIFY_CLAIMS",
  "TYPESAFE_GROUP_CONTEXT_RANKING",
  "TYPESAFE_REPLY_ROUTING",
] as const;

const originalEnvironment = new Map<string, string | undefined>();

function mockJudgment(answers: Record<string, unknown>): TypeSafeSystemOne {
  return async () =>
    ({
      model: "test-model",
      answers,
      usage: { input_tokens: 1, output_tokens: 1 },
    }) as never;
}

function activate(feature: (typeof FEATURE_ENV_NAMES)[number]): void {
  process.env[feature] = "on";
}

describe("TypeSafe judgment integrations", () => {
  beforeEach(() => {
    for (const name of FEATURE_ENV_NAMES) {
      originalEnvironment.set(name, process.env[name]);
      delete process.env[name];
    }
    resetTypeSafeClientForTests();
  });

  afterEach(() => {
    resetTypeSafeClientForTests();
    for (const name of FEATURE_ENV_NAMES) {
      const original = originalEnvironment.get(name);
      if (original === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = original;
      }
    }
  });

  it("keeps the current behavior when a feature is off", async () => {
    let called = false;
    setTypeSafeSystemOneForTests(async () => {
      called = true;
      return undefined as never;
    });

    const selected = await selectHeresyMessages(["Mensaje completo"]);

    expect(selected).toBeUndefined();
    expect(called).toBe(false);
  });

  it("uses a high-confidence semantic match for the self-message guard", async () => {
    const db = new Database(":memory:");
    setupSchema(db);
    db.run(
      `
        INSERT INTO messages (
          message_id, chat_id, chat_type, from_is_bot, text, date
        ) VALUES ($message_id, $chat_id, $chat_type, $from_is_bot, $text, $date)
      `,
      {
        $message_id: 42,
        $chat_id: 77,
        $chat_type: "group",
        $from_is_bot: 1,
        $text: "La gracia transforma al creyente y sostiene su esperanza.",
        $date: 1_700_000_000,
      } as any,
    );
    activate("TYPESAFE_SELF_MESSAGE_GUARD");
    setTypeSafeSystemOneForTests(
      mockJudgment({
        match: {
          type: "choice",
          choice: "42",
          confidence: 0.95,
          probabilities: { none: 0.05, "42": 0.95 },
        },
      }),
    );

    const result = await findSimilarBotMessageInChatWithJudgment(
      db,
      77,
      "What does grace do for a believer?",
    );

    expect(result.blocked).toBe(true);
    expect(result.matchedMessageId).toBe(42);
  });

  it("routes roast preflight decisions without generating replacement text", async () => {
    activate("TYPESAFE_ROAST_PREFLIGHT");
    setTypeSafeSystemOneForTests(
      mockJudgment({
        scripture: { type: "noul", noul: 0.96 },
        coreDoctrineAttack: { type: "noul", noul: 0.1 },
        hasArgument: { type: "noul", noul: 0.2 },
      }),
    );

    const route = await classifyRoastMessage("En el principio creó Dios...");

    expect(route).toBe("scripture");
    expect(buildRoastPolicyInstruction(route)).toContain("Bible passage");
  });

  it("selects full heresy messages and keeps chronological order", async () => {
    activate("TYPESAFE_HERESY_SELECTION");
    const messages = ["Mensaje doctrinal A", "Ruido", "Mensaje doctrinal B"];
    setTypeSafeSystemOneForTests(
      mockJudgment({
        message_0: { type: "score", score: 2, confidence: 0.95 },
        message_1: { type: "score", score: 0.2, confidence: 0.95 },
        message_2: { type: "score", score: 1.5, confidence: 0.95 },
      }),
    );

    const selected = await selectHeresyMessages(messages);

    expect(selected).toEqual([messages[0]!, messages[2]!]);
  });

  it("accepts a semantically valid theology poll", async () => {
    activate("TYPESAFE_THEOLOGY_POLL_VALIDATION");
    setTypeSafeSystemOneForTests(
      mockJudgment({
        oneCorrectAnswer: { type: "noul", noul: 0.96 },
        explanationSupportsAnswer: { type: "noul", noul: 0.94 },
        requestedLanguage: { type: "noul", noul: 0.99 },
        theologyPolicy: { type: "noul", noul: 0.95 },
      }),
    );
    const poll: TheologyQuizPoll = {
      question: "¿Qué confiesa la doctrina de la Trinidad?",
      options: [
        "Un Dios en tres personas",
        "Tres dioses separados",
        "Un solo ángel",
        "Ninguna persona divina",
      ],
      correctOptionId: 0,
      explanation: "La Trinidad confiesa un solo Dios en tres personas.",
      topic: "La Trinidad",
    };

    const valid = await validateTheologyQuizPollSemantics(poll, "es");

    expect(valid).toBe(true);
  });

  it("selects important, checkable claims without truncating their text", async () => {
    activate("TYPESAFE_VERIFY_CLAIMS");
    const message =
      "La gracia salva. La iglesia enseñó esta doctrina. La luna orbita la Tierra.";
    setTypeSafeSystemOneForTests(
      mockJudgment({
        checkable_0: { type: "noul", noul: 0.95 },
        priority_0: { type: "score", score: 2, confidence: 0.95 },
        checkable_1: { type: "noul", noul: 0.9 },
        priority_1: { type: "score", score: 1, confidence: 0.9 },
        checkable_2: { type: "noul", noul: 0.1 },
        priority_2: { type: "score", score: 0, confidence: 0.95 },
      }),
    );

    const selected = await selectVerifyClaims(message);

    expect(splitVerifyClaimCandidates(message)).toEqual([
      "La gracia salva.",
      "La iglesia enseñó esta doctrina.",
      "La luna orbita la Tierra.",
    ]);
    expect(selected).toEqual([
      "La gracia salva.",
      "La iglesia enseñó esta doctrina.",
    ]);
  });

  it("ranks only group context and returns the selected messages in chat order", async () => {
    activate("TYPESAFE_GROUP_CONTEXT_RANKING");
    const messages = ["Primero", "Segundo", "Tercero"];
    setTypeSafeSystemOneForTests(
      mockJudgment({
        message_0: { type: "score", score: 0, confidence: 0.95 },
        message_1: { type: "score", score: 2, confidence: 0.95 },
        message_2: { type: "score", score: 1, confidence: 0.95 },
      }),
    );

    const selected = await rankGroupContextMessages("Pregunta", messages);

    expect(selected).toEqual(["Segundo", "Tercero"]);
  });
});
