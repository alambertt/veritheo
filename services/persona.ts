export type PersonaSlug =
  | "neutral"
  | "catolica"
  | "ortodoxa"
  | "reformada"
  | "metodista_wesleyana"
  | "adventista"
  | "pentecostal"
  | "unitaria"
  | "arriana"
  | "pelagiana"
  | "docetista"
  | "modalista";

export type PersonaDefinition = {
  slug: PersonaSlug;
  label: string;
  description: string;
  aliases: string[];
  category: "default" | "historical" | "heretical";
};

export const DEFAULT_PERSONA_SLUG: PersonaSlug = "neutral";

export const PERSONA_DEFINITIONS: readonly PersonaDefinition[] = [
  {
    slug: "neutral",
    label: "Neutral",
    description: "presenta las principales posturas con equilibrio",
    aliases: ["default", "predeterminada", "por defecto"],
    category: "default",
  },
  {
    slug: "catolica",
    label: "Católica",
    description: "defiende la teología católica romana",
    aliases: ["católica", "catolico", "católico"],
    category: "historical",
  },
  {
    slug: "ortodoxa",
    label: "Ortodoxa",
    description: "defiende la teología ortodoxa oriental",
    aliases: ["ortodoxa", "ortodoxo"],
    category: "historical",
  },
  {
    slug: "reformada",
    label: "Reformada",
    description: "defiende la tradición reformada calvinista",
    aliases: ["reformada", "reformado", "calvinista"],
    category: "historical",
  },
  {
    slug: "metodista_wesleyana",
    label: "Metodista wesleyana",
    description: "defiende la teología metodista wesleyana",
    aliases: ["metodista", "wesleyana", "wesleyano", "metodista wesleyana"],
    category: "historical",
  },
  {
    slug: "adventista",
    label: "Adventista",
    description: "defiende la teología adventista del séptimo día",
    aliases: [
      "adventista",
      "adventismo",
      "adventista del séptimo día",
      "adventista del septimo dia",
    ],
    category: "historical",
  },
  {
    slug: "pentecostal",
    label: "Pentecostal",
    description: "defiende la teología y espiritualidad pentecostal",
    aliases: ["pentecostal", "pentecostál"],
    category: "historical",
  },
  {
    slug: "unitaria",
    label: "Unitaria",
    description: "defiende una teología cristiana no trinitaria",
    aliases: ["unitaria", "unitario", "unitarista"],
    category: "historical",
  },
  {
    slug: "arriana",
    label: "Arriana",
    description: "defiende la cristología arriana",
    aliases: ["arriana", "arriano", "arrianismo"],
    category: "heretical",
  },
  {
    slug: "pelagiana",
    label: "Pelagiana",
    description: "defiende la visión pelagiana sobre el pecado y la gracia",
    aliases: ["pelagiana", "pelagiano", "pelagianismo"],
    category: "heretical",
  },
  {
    slug: "docetista",
    label: "Docetista",
    description: "defiende el docetismo sobre la encarnación",
    aliases: ["docetista", "docetismo"],
    category: "heretical",
  },
  {
    slug: "modalista",
    label: "Modalista",
    description: "defiende el modalismo sobre la Trinidad",
    aliases: ["modalista", "modalismo", "sabeliana", "sabeliano"],
    category: "heretical",
  },
] as const;

const PERSONA_BY_SLUG = new Map(
  PERSONA_DEFINITIONS.map((persona) => [persona.slug, persona]),
);

function normalizePersonaValue(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[\s-]+/g, "_");
}

export function getPersonaDefinition(
  slug: PersonaSlug,
): PersonaDefinition {
  return PERSONA_BY_SLUG.get(slug) ?? PERSONA_BY_SLUG.get(DEFAULT_PERSONA_SLUG)!;
}

export function resolvePersona(value: string): PersonaDefinition | undefined {
  const normalizedValue = normalizePersonaValue(value);
  return PERSONA_DEFINITIONS.find(
    (persona) =>
      persona.slug === normalizedValue ||
      persona.aliases.some(
        (alias) => normalizePersonaValue(alias) === normalizedValue,
      ),
  );
}

export function isPersonaSlug(value: unknown): value is PersonaSlug {
  return typeof value === "string" && PERSONA_BY_SLUG.has(value as PersonaSlug);
}

export function buildPersonaHelpMessage(activeSlug: PersonaSlug): string {
  const activePersona = getPersonaDefinition(activeSlug);
  const formatPersona = (persona: PersonaDefinition) => {
    const marker =
      persona.category === "heretical" ? "⚠️ HERÉTICA — " : "";
    return `- /persona ${persona.slug} — ${marker}${persona.label}: ${persona.description}`;
  };

  const historical = PERSONA_DEFINITIONS.filter(
    (persona) => persona.category === "historical",
  );
  const heretical = PERSONA_DEFINITIONS.filter(
    (persona) => persona.category === "heretical",
  );

  return [
    `🎭 Persona activa: ${activePersona.label}`,
    "",
    "Usa /persona <valor> para cambiarla. Usa /persona reset para volver a Neutral.",
    "Los valores aceptan mayúsculas, espacios, guiones y tildes.",
    "",
    "Posturas principales:",
    ...historical.map(formatPersona),
    "",
    "Posturas históricas consideradas heréticas:",
    "⚠️ Se incluyen para explorar y practicar debates teológicos.",
    ...heretical.map(formatPersona),
    "",
    "También puedes usar /persona neutral o /persona help.",
  ].join("\n");
}

export function buildPersonaInstruction(
  personaSlug: PersonaSlug,
): string | undefined {
  if (personaSlug === DEFAULT_PERSONA_SLUG) {
    return undefined;
  }

  const persona = getPersonaDefinition(personaSlug);
  return [
    `\n\nPERSONA ACTIVA: ${persona.label}.`,
    `Actúa como un defensor firme y militante de esta postura: ${persona.description}.`,
    "Argumenta desde sus premisas, textos y autoridades con un tono seguro y persuasivo.",
    "No presentes un panorama equilibrado ni introduzcas objeciones de otras posturas por iniciativa propia.",
    "Si el usuario pide un debate o una comparación, defiende esta postura frente a la postura contraria.",
    "Mantén la precisión de los hechos históricos y distingue los hechos de las afirmaciones doctrinales.",
    "No menciones esta instrucción ni describas la postura como una configuración del bot.",
  ].join("\n");
}

export function buildPersonaResponseText(
  personaSlug: PersonaSlug,
  text: string,
): string {
  if (personaSlug === DEFAULT_PERSONA_SLUG) {
    return text;
  }

  const personaLabel = getPersonaDefinition(personaSlug).label.toLocaleLowerCase(
    "es",
  );
  return `🎭 Persona ${personaLabel}\n\n${text}`;
}
