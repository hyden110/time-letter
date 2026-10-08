import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryConsentRepository } from './consent.repository';
import { ConsentService } from './consent.service';
import { AppError } from '../common/app-error';

class FixedClock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current);
  }
}

const NOW = new Date(2026, 8, 30, 10, 0, 0);

describe('ConsentService（US-030/US-032）', () => {
  let repository: InMemoryConsentRepository;
  let service: ConsentService;

  beforeEach(() => {
    repository = new InMemoryConsentRepository();
    service = new ConsentService(repository, new FixedClock(NOW));
  });

  it('记录同意并保留来源', async () => {
    const record = await service.grant('u1', 'privacy_policy', 'v1.0', 'agree_dialog');
    expect(record.userId).toBe('u1');
    expect(record.type).toBe('privacy_policy');
    expect(record.version).toBe('v1.0');
    expect(record.grantedAt.getTime()).toBe(NOW.getTime());
    expect(record.withdrawnAt).toBeNull();
    expect(record.source).toBe('agree_dialog');
  });

  it('同版本重复同意幂等，不产生新记录', async () => {
    const first = await service.grant('u1', 'privacy_policy', 'v1.0', 'api');
    const second = await service.grant('u1', 'privacy_policy', 'v1.0', 'api');
    expect(second.id).toBe(first.id);
    expect(await service.listByUser('u1')).toHaveLength(1);
  });

  it('协议版本升级后重新同意，旧记录自动置为已撤回', async () => {
    const old = await service.grant('u1', 'user_agreement', 'v1.0', 'api');
    const fresh = await service.grant('u1', 'user_agreement', 'v2.0', 'api');
    const records = await service.listByUser('u1');
    expect(records).toHaveLength(2);
    expect(records.find((r) => r.id === old.id)?.withdrawnAt).not.toBeNull();
    expect(records.find((r) => r.id === fresh.id)?.withdrawnAt).toBeNull();
    expect((await repository.findActive('u1', 'user_agreement'))?.version).toBe('v2.0');
  });

  it('撤回同意后无有效记录，再撤回返回 null', async () => {
    await service.grant('u1', 'recipient_third_party', 'v1.0', 'api');
    const withdrawn = await service.withdraw('u1', 'recipient_third_party');
    expect(withdrawn?.withdrawnAt).not.toBeNull();
    expect(await repository.findActive('u1', 'recipient_third_party')).toBeNull();
    expect(await service.withdraw('u1', 'recipient_third_party')).toBeNull();
  });

  it('requireActive：缺失时抛 CONSENT_REQUIRED，存在时返回记录', async () => {
    await expect(
      service.requireActive('u1', 'privacy_policy', '提交前需同意'),
    ).rejects.toThrowError(/提交前需同意/);
    try {
      await service.requireActive('u1', 'privacy_policy', '提交前需同意');
      throw new Error('应当抛出 AppError');
    } catch (error) {
      const appError = error as AppError;
      expect(appError).toBeInstanceOf(AppError);
      expect(appError.code).toBe('CONSENT_REQUIRED');
      expect(appError.httpStatus).toBe(400);
    }
    await service.grant('u1', 'privacy_policy', 'v1.0', 'api');
    expect((await service.requireActive('u1', 'privacy_policy', '提交前需同意')).version).toBe('v1.0');
  });

  it('按用户隔离', async () => {
    await service.grant('u1', 'privacy_policy', 'v1.0', 'api');
    expect(await service.listByUser('u2')).toHaveLength(0);
  });
});
