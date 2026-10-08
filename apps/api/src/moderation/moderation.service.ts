import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { LetterContent } from '@timeletter/shared';
import { AppError } from '../common/app-error';
import { TOKENS } from '../tokens';
import type { Clock } from '../platform/clock';
import type { ModerationRecord, ModerationRepository } from './moderation.repository';
import type { ContentModerationProvider } from './moderation.providers';

export interface ModerationOutcome {
  record: ModerationRecord;
  /** 自动审核是否直接通过。false 表示进入待人工审核队列。 */
  autoPassed: boolean;
}

@Injectable()
export class ModerationService {
  constructor(
    @Inject(TOKENS.ModerationRepository) private readonly repository: ModerationRepository,
    @Inject(TOKENS.ContentModerationProvider)
    private readonly provider: ContentModerationProvider,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
  ) {}

  /**
   * US-024：提交信笺内容时自动过敏感词库 + 微信内容安全 API（开发期为 Mock）。
   * 命中则标记待人工审核（不阻断提交），否则记录通过。
   */
  async reviewLetter(letterId: string, content: LetterContent): Promise<ModerationOutcome> {
    const result = this.provider.check(content.text);
    const autoPassed = result.passed;
    const now = this.clock.now();
    const record = await this.repository.create({
      id: `mod_${randomUUID()}`,
      letterId,
      decision: autoPassed ? 'passed' : 'pending_human_review',
      hits: result.hits,
      providerResults: [{ provider: result.provider, passed: result.passed }],
      reviewerId: null,
      reason: null,
      createdAt: now,
      resolvedAt: autoPassed ? now : null,
    });
    return { record, autoPassed };
  }

  /** 人工审核队列（命中自动审核的信笺） */
  async listQueue(): Promise<ModerationRecord[]> {
    return this.repository.listByDecision('pending_human_review');
  }

  /**
   * 管理员人工审核裁决（US-024）。驳回必须给出原因；用户侧据此提示修改后重新提交。
   */
  async resolve(
    recordId: string,
    action: 'approve' | 'reject',
    reviewerId: string,
    reason?: string,
  ): Promise<ModerationRecord> {
    const record = await this.repository.findById(recordId);
    if (!record) {
      throw AppError.notFound('审核记录不存在');
    }
    if (record.decision !== 'pending_human_review') {
      throw AppError.forbiddenState('该审核记录已处理，不能重复操作');
    }
    if (action === 'reject' && !reason?.trim()) {
      throw AppError.validation([{ field: 'reason', message: '驳回时必须填写驳回原因' }]);
    }
    const updated = await this.repository.update(recordId, {
      decision: action === 'approve' ? 'approved' : 'rejected',
      reviewerId,
      reason: action === 'reject' ? reason!.trim() : null,
      resolvedAt: this.clock.now(),
    });
    if (!updated) {
      throw AppError.notFound('审核记录不存在');
    }
    return updated;
  }

  async getByLetterId(letterId: string): Promise<ModerationRecord | null> {
    return this.repository.findByLetterId(letterId);
  }
}
