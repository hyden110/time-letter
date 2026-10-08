/**
 * 领域状态常量（前后端共用，避免字符串散落）。
 * 状态流转见 apps/api/src/letters/letters.service.ts。
 */

export const LETTER_STATUSES = [
  'draft',
  'moderation_pending',
  'rejected',
  'pending_payment',
  'in_custody',
  'frozen',
] as const;
export type LetterStatus = (typeof LETTER_STATUSES)[number];

export const ORDER_STATUSES = ['pending_payment', 'no_payment_required', 'paid'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const CONSENT_TYPES = ['privacy_policy', 'user_agreement', 'recipient_third_party'] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export const MODERATION_DECISIONS = [
  'passed',
  'pending_human_review',
  'approved',
  'rejected',
] as const;
export type ModerationDecision = (typeof MODERATION_DECISIONS)[number];
