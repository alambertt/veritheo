import type { Database } from 'bun:sqlite';
import { queryMessages } from './sqlite';

function normalizeForSimilarity(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordNgrams(tokens: string[], n: number): string[] {
  if (n <= 0 || tokens.length < n) {
    return [];
  }
  const grams: string[] = [];
  for (let index = 0; index <= tokens.length - n; index++) {
    grams.push(tokens.slice(index, index + n).join('\u0001'));
  }
  return grams;
}

function containmentCoefficient(promptText: string, candidateText: string, n = 5): number {
  if (!promptText || !candidateText) {
    return 0;
  }
  if (promptText === candidateText) {
    return 1;
  }

  const promptTokens = promptText.split(' ').filter(Boolean);
  const candidateTokens = candidateText.split(' ').filter(Boolean);
  const promptNgrams = wordNgrams(promptTokens, n);
  if (promptNgrams.length === 0) {
    return 0;
  }

  const candidateSet = new Set(wordNgrams(candidateTokens, n));
  let hits = 0;
  for (const gram of promptNgrams) {
    if (candidateSet.has(gram)) {
      hits++;
    }
  }
  return hits / promptNgrams.length;
}

function trigramCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  if (text.length < 3) {
    if (text.length > 0) {
      counts.set(text, 1);
    }
    return counts;
  }

  for (let index = 0; index <= text.length - 3; index++) {
    const trigram = text.slice(index, index + 3);
    counts.set(trigram, (counts.get(trigram) ?? 0) + 1);
  }
  return counts;
}

function diceCoefficient(a: string, b: string): number {
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }

  const aCounts = trigramCounts(a);
  const bCounts = trigramCounts(b);
  let intersection = 0;
  let aTotal = 0;
  let bTotal = 0;

  for (const value of aCounts.values()) {
    aTotal += value;
  }
  for (const value of bCounts.values()) {
    bTotal += value;
  }

  for (const [trigram, aCount] of aCounts.entries()) {
    const bCount = bCounts.get(trigram);
    if (bCount) {
      intersection += Math.min(aCount, bCount);
    }
  }

  return (2 * intersection) / (aTotal + bTotal);
}

export function findSimilarBotMessageInChat(
  db: Database,
  chatId: number,
  promptText: string,
  options: {
    threshold?: number;
    pageSize?: number;
    maxMessagesToScan?: number;
    containmentThreshold?: number;
    minPromptCharsForSubstring?: number;
    minPromptTokensForContainment?: number;
    containmentNgramSize?: number;
  } = {}
): { blocked: boolean; similarity: number; matchedMessageId?: number } {
  const threshold = options.threshold ?? 0.85;
  const containmentThreshold = options.containmentThreshold ?? threshold;
  const minPromptCharsForSubstring = options.minPromptCharsForSubstring ?? 40;
  const minPromptTokensForContainment = options.minPromptTokensForContainment ?? 8;
  const pageSize = options.pageSize ?? 200;
  const maxMessagesToScan = options.maxMessagesToScan ?? 2000;
  const normalizedPrompt = normalizeForSimilarity(promptText);

  if (!normalizedPrompt) {
    return { blocked: false, similarity: 0 };
  }

  const promptTokens = normalizedPrompt.split(' ').filter(Boolean);
  const containmentNgramSize =
    options.containmentNgramSize ??
    (promptTokens.length >= 20 ? 5 : promptTokens.length >= 12 ? 4 : 3);

  let bestSimilarity = 0;
  let bestMessageId: number | undefined;
  let scanned = 0;
  let offset = 0;

  while (scanned < maxMessagesToScan) {
    const remaining = maxMessagesToScan - scanned;
    const limit = Math.max(1, Math.min(pageSize, remaining));
    const botMessages = queryMessages(db, { chatId, fromIsBot: true, limit, offset, order: 'desc' }).filter(
      msg => typeof msg.text === 'string' && msg.text.trim().length > 0
    );
    if (botMessages.length === 0) {
      break;
    }

    for (const message of botMessages) {
      const normalizedCandidate = normalizeForSimilarity(message.text!);
      if (!normalizedCandidate) {
        continue;
      }

      if (
        normalizedPrompt.length >= minPromptCharsForSubstring &&
        normalizedCandidate.length >= normalizedPrompt.length &&
        normalizedCandidate.includes(normalizedPrompt)
      ) {
        return { blocked: true, similarity: 1, matchedMessageId: message.message_id };
      }

      if (promptTokens.length >= minPromptTokensForContainment) {
        const containment = containmentCoefficient(normalizedPrompt, normalizedCandidate, containmentNgramSize);
        if (containment >= containmentThreshold) {
          return { blocked: true, similarity: containment, matchedMessageId: message.message_id };
        }
      }

      const similarity = diceCoefficient(normalizedPrompt, normalizedCandidate);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMessageId = message.message_id;
        if (bestSimilarity >= threshold) {
          return { blocked: true, similarity: bestSimilarity, matchedMessageId: bestMessageId };
        }
      }
    }

    scanned += botMessages.length;
    offset += botMessages.length;
  }

  return {
    blocked: bestSimilarity >= threshold,
    similarity: bestSimilarity,
    matchedMessageId: bestMessageId,
  };
}
