/**
 * US-005：封缄预览的费用计算（PRD §2.1 三档定价）。
 * 与支付开关（PAYMENT_ENABLED）联动：
 * - 关闭（一期默认）：payableAmountCents = 0，CTA 为「提交托管」（submit_custody）；
 * - 开启：payableAmountCents = 标价，CTA 为「确认并支付」（pay）。
 */

export const LETTER_PRICES_CENTS = {
  electronic: 990,
  entity_standard: 4900,
  entity_handmade: 9900,
} as const;

export type LetterType = keyof typeof LETTER_PRICES_CENTS;

export type PreviewCta = 'pay' | 'submit_custody';

export interface PreviewFee {
  currency: 'CNY';
  /** 目录标价（快照给前端展示划线价/说明用） */
  listAmountCents: number;
  /** 实付金额；支付开关关闭时为 0 */
  payableAmountCents: number;
  cta: PreviewCta;
}

export function computePreviewFee(letterType: LetterType, paymentEnabled: boolean): PreviewFee {
  const listAmountCents = LETTER_PRICES_CENTS[letterType];
  return {
    currency: 'CNY',
    listAmountCents,
    payableAmountCents: paymentEnabled ? listAmountCents : 0,
    cta: paymentEnabled ? 'pay' : 'submit_custody',
  };
}

export function formatCentsAsYuan(cents: number): string {
  return (cents / 100).toFixed(2);
}
