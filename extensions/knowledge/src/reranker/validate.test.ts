import { describe, expect, it } from 'vitest';

import { validateRerankResults } from './validate.js';

describe('validateRerankResults', () => {
  it('sorts deterministically and restores text from trusted input', () => {
    expect(validateRerankResults([
      { index: 0, relevance_score: 0.2, document: 'spoofed' },
      { index: 1, relevance_score: 0.9 },
    ], ['first', 'second'], 1, 'Test')).toEqual([
      { index: 1, score: 0.9, text: 'second' },
    ]);
  });

  it('rejects duplicate indexes, out-of-range indexes, and invalid scores', () => {
    expect(() => validateRerankResults([
      { index: 0, score: 0.5 }, { index: 0, score: 0.4 },
    ], ['one'], undefined, 'Test')).toThrow(/duplicate/);
    expect(() => validateRerankResults([{ index: 2, score: 0.5 }], ['one'], undefined, 'Test'))
      .toThrow(/out-of-range/);
    expect(() => validateRerankResults([{ index: 0, score: Number.NaN }], ['one'], undefined, 'Test'))
      .toThrow(/outside 0-1/);
  });
});
