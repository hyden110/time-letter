import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryRecipientRepository } from './recipients.repository';
import { RecipientsService } from './recipients.service';
import { InMemoryConsentRepository } from '../consent/consent.repository';
import { ConsentService } from '../consent/consent.service';
import { AppError } from '../common/app-error';

class FixedClock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current);
  }
}

const NOW = new Date(2026, 8, 30, 10, 0, 0);

describe('RecipientsService（US-004）', () => {
  let repository: InMemoryRecipientRepository;
  let consentService: ConsentService;
  let service: RecipientsService;

  beforeEach(() => {
    repository = new InMemoryRecipientRepository();
    consentService = new ConsentService(new InMemoryConsentRepository(), new FixedClock(NOW));
    service = new RecipientsService(repository, new FixedClock(NOW), consentService);
  });

  it('邮箱必填且合法时创建成功，手机号常规化存储', async () => {
    const record = await service.create('u1', {
      email: ' future@example.com ',
      phone: '138 0013-8000',
      wechatNickname: '小未来',
      isSelf: true,
    });
    expect(record.email).toBe('future@example.com');
    expect(record.phone).toBe('13800138000');
    expect(record.wechatNickname).toBe('小未来');
  });

  it('邮箱缺失/格式错误时报明确文案', async () => {
    await expect(service.create('u1', { email: '', isSelf: true })).rejects.toThrowError(
      /请填写收件邮箱/,
    );
    await expect(service.create('u1', { email: 'not-an-email', isSelf: true })).rejects.toThrowError(
      /请输入正确的邮箱地址/,
    );
  });

  it('手机号选填；不校验号段（BR-1）', async () => {
    const record = await service.create('u1', {
      email: 'a@b.com',
      phone: '99912345678',
      isSelf: true,
    });
    expect(record.phone).toBe('99912345678');
    expect((await service.create('u2', { email: 'a@b.com', isSelf: true })).phone).toBeNull();
  });

  it('手机号非法时拒绝', async () => {
    try {
      await service.create('u1', { email: 'a@b.com', phone: '123', isSelf: true });
      throw new Error('应当抛出校验错误');
    } catch (error) {
      const appError = error as AppError;
      expect(appError).toBeInstanceOf(AppError);
      expect(appError.code).toBe('VALIDATION_FAILED');
      expect(appError.details[0]?.message).toBe('请输入正确的手机号');
    }
  });

  it('填写他人收件信息需先同意第三方提供告知', async () => {
    await expect(service.create('u1', { email: 'a@b.com' })).rejects.toThrowError(
      /第三方信息提供告知/,
    );
    try {
      await service.create('u1', { email: 'a@b.com' });
    } catch (error) {
      expect((error as AppError).code).toBe('CONSENT_REQUIRED');
    }
    await consentService.grant('u1', 'recipient_third_party', 'v1.0', 'api');
    expect((await service.create('u1', { email: 'a@b.com' })).id).toContain('rcpt_');
  });

  it('getMine 越权访问返回 404', async () => {
    const record = await service.create('u1', { email: 'a@b.com', isSelf: true });
    await expect(service.getMine('u2', record.id)).rejects.toThrowError(/收件信息不存在/);
    expect((await service.getMine('u1', record.id)).email).toBe('a@b.com');
  });
});
