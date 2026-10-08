import { describe, expect, it } from 'vitest';
import { LETTER_PRICES_CENTS, computePreviewFee, formatCentsAsYuan } from './fee';

describe('US-005 preview fee', () => {
  it('uses the three-tier pricing from PRD §2.1', () => {
    expect(LETTER_PRICES_CENTS).toEqual({
      electronic: 990,
      entity_standard: 4900,
      entity_handmade: 9900,
    });
  });

  it('when payment is disabled: payable is 0 and CTA is submit_custody', () => {
    expect(computePreviewFee('electronic', false)).toEqual({
      currency: 'CNY',
      listAmountCents: 990,
      payableAmountCents: 0,
      cta: 'submit_custody',
    });
  });

  it('when payment is enabled: payable equals list price and CTA is pay', () => {
    expect(computePreviewFee('electronic', true)).toEqual({
      currency: 'CNY',
      listAmountCents: 990,
      payableAmountCents: 990,
      cta: 'pay',
    });
  });

  it('applies to entity tiers as well (phase 2 ready)', () => {
    expect(computePreviewFee('entity_standard', true).payableAmountCents).toBe(4900);
    expect(computePreviewFee('entity_handmade', true).payableAmountCents).toBe(9900);
  });

  it('formats cents as yuan', () => {
    expect(formatCentsAsYuan(990)).toBe('9.90');
    expect(formatCentsAsYuan(0)).toBe('0.00');
  });
});
