/**
 * 法务/运营文案占位 key（决策 B3：功能框架先落地，不代拟法律文本）。
 * 前端按 key 取词；法务定稿后由产品替换文案映射，代码无需改动。
 */

export const COPY_KEYS = {
  agreePrivacyTitle: 'AGREE_PRIVACY_TITLE',
  agreePrivacyBody: 'AGREE_PRIVACY_BODY',
  agreeTermsTitle: 'AGREE_TERMS_TITLE',
  agreeTermsBody: 'AGREE_TERMS_BODY',
  agreeRecipientThirdPartyTitle: 'AGREE_RECIPIENT_THIRD_PARTY_TITLE',
  agreeRecipientThirdPartyBody: 'AGREE_RECIPIENT_THIRD_PARTY_BODY',
  withdrawConsentLabel: 'WITHDRAW_CONSENT_LABEL',
  withdrawConsentConfirm: 'WITHDRAW_CONSENT_CONFIRM',
  consentWithdrawnNotice: 'CONSENT_WITHDRAWN_NOTICE',
} as const;

export type CopyKey = (typeof COPY_KEYS)[keyof typeof COPY_KEYS];

export type CopyOverrides = Partial<Record<CopyKey, string>>;

/**
 * 解析文案：有覆盖文案则使用覆盖文案，否则回退为占位 key 本身
 * （前端开发期按 key 展示和联调，避免占位假文案进入代码库）。
 */
export function resolveCopy(key: CopyKey, overrides?: CopyOverrides): string {
  const override = overrides?.[key];
  if (override !== undefined && override.trim().length > 0) {
    return override;
  }
  return key;
}
