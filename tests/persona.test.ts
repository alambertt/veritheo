import { describe, expect, it } from "bun:test";
import {
  buildPersonaHelpMessage,
  buildPersonaInstruction,
  buildPersonaResponseText,
  resolvePersona,
} from "../services/persona";

describe("persona helpers", () => {
  it("resolves normalized aliases", () => {
    expect(resolvePersona("Católica")?.slug).toBe("catolica");
    expect(resolvePersona("CATÓLICA")?.slug).toBe("catolica");
    expect(resolvePersona("PENTECOSTÁL")?.slug).toBe("pentecostal");
    expect(resolvePersona("metodista wesleyana")?.slug).toBe(
      "metodista_wesleyana",
    );
    expect(resolvePersona("ARrianismo")?.slug).toBe("arriana");
  });

  it("returns no persona for unknown values", () => {
    expect(resolvePersona("bautista")).toBeUndefined();
  });

  it("builds help with the active persona and heretical options", () => {
    const help = buildPersonaHelpMessage("neutral");

    expect(help).toContain("Persona activa: Neutral");
    expect(help).toContain("/persona metodista_wesleyana");
    expect(help).toContain("/persona arriana");
    expect(help).toContain("⚠️ HERÉTICA — Arriana");
    expect(help).toContain("explorar y practicar debates");
    expect(help).toContain("/persona reset");
    expect(help).toContain("tildes");
  });

  it("builds a committed instruction for non-neutral personas", () => {
    const instruction = buildPersonaInstruction("modalista");

    expect(instruction).toContain("PERSONA ACTIVA: Modalista");
    expect(instruction).toContain("militante");
    expect(instruction).toContain("No presentes un panorama equilibrado");
  });

  it("does not add a persona instruction for neutral", () => {
    expect(buildPersonaInstruction("neutral")).toBeUndefined();
  });

  it("adds a visible header only for active non-neutral personas", () => {
    expect(buildPersonaResponseText("pentecostal", "Respuesta")).toBe(
      "🎭 Persona pentecostal\nRespuesta",
    );
    expect(buildPersonaResponseText("neutral", "Respuesta")).toBe("Respuesta");
  });
});
