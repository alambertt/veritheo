import { describe, expect, it } from "bun:test";
import { buildContextEntry } from "../services/context-author";

const botUsernames = ["veritheo_bot", "VeritheoAI"];

describe("buildContextEntry", () => {
  it("labels a user with name and username", () => {
    expect(
      buildContextEntry(
        {
          from_first_name: "Ana",
          from_last_name: "Pérez",
          from_username: "ana",
          text: " Hola ",
        },
        botUsernames,
      ),
    ).toBe("Ana Pérez (@ana): Hola");
  });

  it("falls back to the username, then to a generic label", () => {
    expect(buildContextEntry({ from_username: "ana", text: "a" }, botUsernames)).toBe(
      "@ana: a",
    );
    expect(buildContextEntry({ text: "a" }, botUsernames)).toBe("Usuario: a");
  });

  it("labels Veritheo's own messages by any of its usernames", () => {
    expect(
      buildContextEntry(
        { from_is_bot: true, from_username: "VERITHEO_BOT", text: "Respuesta" },
        botUsernames,
      ),
    ).toBe("Veritheo: Respuesta");
  });

  it("skips messages from other bots but keeps anonymous admins", () => {
    expect(
      buildContextEntry(
        { from_is_bot: true, from_username: "MeowieQBot", text: "meow" },
        botUsernames,
      ),
    ).toBeUndefined();
    expect(
      buildContextEntry(
        { from_is_bot: true, from_username: "GroupAnonymousBot", text: "Aviso" },
        botUsernames,
      ),
    ).toBe("Admin anónimo: Aviso");
  });

  it("skips empty messages", () => {
    expect(buildContextEntry({ from_username: "ana", text: "  " }, botUsernames)).toBeUndefined();
  });
});
