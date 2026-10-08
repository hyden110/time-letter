import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ConsentType } from '@timeletter/shared';
import { AppError } from '../common/app-error';
import { TOKENS } from '../tokens';
import type { Clock } from '../platform/clock';
import type { ConsentRecord, ConsentRepository } from './consent.repository';

@Injectable()
export class ConsentService {
  constructor(
    @Inject(TOKENS.ConsentRepository) private readonly repository: ConsentRepository,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
  ) {}

  /**
   * 记录用户同意。同一版本重复同意幂等（返回既有记录）；
   * 版本升级后重新同意时，旧版本记录自动置为已撤回。
   */
  async grant(userId: string, type: ConsentType, version: string, source: string): Promise<ConsentRecord> {
    const active = await this.repository.findActive(userId, type);
    if (active) {
      if (active.version === version) {
        return active;
      }
      await this.repository.withdraw(active.id, this.clock.now());
    }
    return this.repository.create({
      id: `consent_${randomUUID()}`,
      userId,
      type,
      version,
      grantedAt: this.clock.now(),
      withdrawnAt: null,
      source,
    });
  }

  /** 撤回同意（US-032）。无有效同意记录时返回 null，由调用方决定是否报错。 */
  async withdraw(userId: string, type: ConsentType): Promise<ConsentRecord | null> {
    const active = await this.repository.findActive(userId, type);
    if (!active) {
      return null;
    }
    return this.repository.withdraw(active.id, this.clock.now());
  }

  async listByUser(userId: string): Promise<ConsentRecord[]> {
    return this.repository.listByUser(userId);
  }

  /** 校验存在有效同意，否则抛出 CONSENT_REQUIRED。 */
  async requireActive(userId: string, type: ConsentType, message: string): Promise<ConsentRecord> {
    const active = await this.repository.findActive(userId, type);
    if (!active) {
      throw AppError.consentRequired([{ field: 'consent', message: `${message}：${type}` }]);
    }
    return active;
  }
}
