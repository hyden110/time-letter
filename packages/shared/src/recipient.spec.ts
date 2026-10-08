import { describe, expect, it } from 'vitest';
import { maskEmail, maskPhone, normalizePhone, validateRecipient } from './recipient';

describe('US-004 recipient validation', () => {
  it('accepts email with no phone (phase 1 electronic: phone optional)', () => {
    const result = validateRecipient({ email: 'zhangsan@example.com' });
    expect(result.ok).toBe(true);
  });

  it('requires an email', () => {
    const result = validateRecipient({ email: '  ' });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([{ field: 'email', message: '请填写收件邮箱' }]);
  });

  it('rejects malformed email with PRD copy', () => {
    const result = validateRecipient({ email: 'zhangsan.example.com' });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([{ field: 'email', message: '请输入正确的邮箱地址' }]);
  });

  it('accepts an 11-digit phone', () => {
    const result = validateRecipient({ email: 'a@b.com', phone: '13812345678' });
    expect(result.ok).toBe(true);
  });

  it('accepts a phone with spaces or hyphens', () => {
    expect(normalizePhone('138 1234 5678')).toBe('13812345678');
    const result = validateRecipient({ email: 'a@b.com', phone: '138-1234-5678' });
    expect(result.ok).toBe(true);
  });

  it('rejects a phone that is not 11 digits (no segment check per BR-1 default)', () => {
    const result = validateRecipient({ email: 'a@b.com', phone: '1990000' });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([{ field: 'phone', message: '请输入正确的手机号' }]);
  });

  it('reports both email and phone errors together', () => {
    const result = validateRecipient({ email: 'bad', phone: '123' });
    expect(result.errors.map((error) => error.field)).toEqual(['email', 'phone']);
  });
});

describe('recipient masking', () => {
  it('masks email as first 3 chars + ***@domain (PRD §3.4)', () => {
    expect(maskEmail('zhangsan@example.com')).toBe('zha***@example.com');
  });

  it('keeps short local parts intact', () => {
    expect(maskEmail('ab@qq.com')).toBe('ab***@qq.com');
  });

  it('returns *** for malformed email', () => {
    expect(maskEmail('not-an-email')).toBe('***');
    expect(maskEmail('@qq.com')).toBe('***');
    expect(maskEmail('ab@')).toBe('***');
  });

  it('masks phone as 138****5678', () => {
    expect(maskPhone('13812345678')).toBe('138****5678');
  });

  it('returns *** for malformed phone', () => {
    expect(maskPhone('123')).toBe('***');
  });
});
