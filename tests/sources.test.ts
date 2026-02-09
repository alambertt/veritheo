import { describe, expect, it } from 'bun:test';
import { buildSourcesMessage } from '../services/sources';

describe('buildSourcesMessage', () => {
  it('returns undefined for non-array sources', () => {
    expect(buildSourcesMessage(undefined)).toBeUndefined();
    expect(buildSourcesMessage({})).toBeUndefined();
  });

  it('filters invalid entries and formats unique sources', () => {
    const message = buildSourcesMessage([
      { sourceType: 'url', url: 'https://example.com/page', title: 'Example' },
      { sourceType: 'url', url: 'https://example.com/page', title: 'Duplicate' },
      { sourceType: 'url', url: ' https://example.com/other ', title: '' },
      { sourceType: 'text', url: 'https://ignored.com' },
      null,
    ]);

    expect(message).toBeDefined();
    expect(message).toContain('[Example](https://example.com/page)');
    expect(message).toContain('[example.com](https://example.com/other)');
  });

  it('escapes markdown in titles and falls back to url when parsing fails', () => {
    const message = buildSourcesMessage([
      { sourceType: 'url', url: 'not-a-url', title: '*Title*' },
    ]);

    expect(message).toContain('[\\*Title\\*](not-a-url)');
  });
});
