import { describe, expect, it } from 'vitest';

import { selectAccountId } from './outbound.js';

describe('outbound', () => {
  it('prefers explicit accountId', () => {
    expect(selectAccountId({ cfg: {}, accountId: 'ops', to: 'default' })).toBe('ops');
  });

  it('falls back to target-derived account id', () => {
    expect(selectAccountId({ cfg: {}, to: 'gotify:alerts' })).toBe('alerts');
  });
});
