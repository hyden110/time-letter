import { describe, expect, it } from 'vitest';
import { COPY_KEYS, resolveCopy } from './copy-keys';

describe('legal copy placeholder keys (decision B3)', () => {
  it('falls back to the key itself when no override is provided', () => {
    expect(resolveCopy(COPY_KEYS.agreePrivacyBody)).toBe('AGREE_PRIVACY_BODY');
  });

  it('uses an override when provided', () => {
    const overrides = { AGREE_PRIVACY_BODY: '（法务定稿文案）' } as const;
    expect(resolveCopy(COPY_KEYS.agreePrivacyBody, overrides)).toBe('（法务定稿文案）');
  });

  it('falls back to the key when the override is blank', () => {
    const overrides = { AGREE_PRIVACY_BODY: '   ' };
    expect(resolveCopy(COPY_KEYS.agreePrivacyBody, overrides)).toBe('AGREE_PRIVACY_BODY');
  });

  it('exposes UPPER_SNAKE keys only (they double as placeholders)', () => {
    for (const value of Object.values(COPY_KEYS)) {
      expect(value).toMatch(/^[A-Z0-9_]+$/);
    }
  });
});
