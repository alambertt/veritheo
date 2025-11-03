import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { GOOGLE_MODEL_BASIC } from '../constants';

const systemPrompt = `
Eres un asistente especializado en crear resúmenes claros, fieles y concisos en español.
Debes:
- Priorizar las ideas principales y su relación lógica.
- Mantener nombres propios, citas textuales y datos clave cuando sean cruciales para el significado.
- Escribir en tono neutro y fluido, evitando viñetas salvo que sean indispensables.
- Limitar la respuesta a un máximo de {{limit}} caracteres (incluye espacios).
- Si el texto ya es muy breve, devuelve una paráfrasis condensada sin añadir información nueva.
`;

export async function summarizeText(text: string, limitChars = 4000): Promise<string> {
  if (!text.trim()) {
    return '';
  } else if (text.length <= limitChars) {
    return text;
  }

  const { text: summaryCandidate } = await generateText({
    model: google(GOOGLE_MODEL_BASIC),
    system: systemPrompt.replace('{{limit}}', String(limitChars)),
    messages: [
      {
        role: 'user',
        content: [
          `Redacta un resumen en español que no supere ${limitChars} caracteres (incluyendo espacios).`,
          'Conserva la intención original y señala relaciones clave entre ideas.',
          'Texto a resumir:',
          text,
        ].join('\n\n'),
      },
    ],
  });

  if (!summaryCandidate) {
    return text.length > limitChars ? `${text.slice(0, limitChars - 1)}…` : text;
  }

  // Garantiza el límite duro de caracteres aun si el modelo se excede.
  const trimmed = summaryCandidate.trim();
  if (trimmed.length <= limitChars) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(limitChars - 1, 0)).trimEnd()}…`;
}
