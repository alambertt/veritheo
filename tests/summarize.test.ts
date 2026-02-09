import { describe, expect, it } from 'bun:test';
import { summarizeText } from '../services/summarize';

describe('summarizeText', () => {
  it('returns empty string when input is blank', async () => {
    await expect(summarizeText('   ')).resolves.toBe('');
  });

  it('returns the original text when under the limit', async () => {
    const input = 'Texto breve.';
    await expect(summarizeText(input, 100)).resolves.toBe(input);
  });
});
