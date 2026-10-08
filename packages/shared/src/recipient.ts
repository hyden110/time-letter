/**
 * US-004：收件人信息校验与脱敏。
 * 一期（电子信笺）：邮箱必填 + 微信昵称选填；手机号选填（实体信笺阶段必填）。
 * 手机号按 PRD 待确认项 BR-1 默认值：仅校验 11 位数字格式，不做号段校验。
 * 邮箱脱敏按 PRD §3.4：显示前 3 位 + ***@域名。
 */

export interface RecipientInput {
  email: string;
  wechatNickname?: string;
  phone?: string;
  isSelf?: boolean;
}

export interface RecipientFieldError {
  field: 'email' | 'phone';
  message: string;
}

export interface RecipientValidationResult {
  ok: boolean;
  errors: RecipientFieldError[];
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\d{11}$/;

export function normalizePhone(phone: string): string {
  return phone.replace(/[\s-]/g, '');
}

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

export function validateRecipient(input: RecipientInput): RecipientValidationResult {
  const errors: RecipientFieldError[] = [];

  const email = (input.email ?? '').trim();
  if (email.length === 0) {
    errors.push({ field: 'email', message: '请填写收件邮箱' });
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.push({ field: 'email', message: '请输入正确的邮箱地址' });
  }

  const rawPhone = (input.phone ?? '').trim();
  if (rawPhone.length > 0 && !PHONE_PATTERN.test(normalizePhone(rawPhone))) {
    errors.push({ field: 'phone', message: '请输入正确的手机号' });
  }

  return { ok: errors.length === 0, errors };
}

export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) {
    return '***';
  }
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, Math.min(3, local.length));
  return `${head}***@${domain}`;
}

export function maskPhone(phone: string): string {
  const normalized = normalizePhone(phone);
  if (!PHONE_PATTERN.test(normalized)) {
    return '***';
  }
  return `${normalized.slice(0, 3)}****${normalized.slice(7)}`;
}
