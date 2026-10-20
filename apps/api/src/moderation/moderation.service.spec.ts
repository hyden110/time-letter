import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryModerationRepository } from './moderation.repository';
import { ModerationService } from './moderation.service';
import { CompositeModerationProvider, SensitiveWordProvider } from './moderation.providers';
import { AppError } from '../common/app-error';

class FixedClock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current);
  }
}

const NOW = new Date(2026, 8, 30, 10, 0, 0);

function createService(): ModerationService {
  const provider = new CompositeModerationProvider([new SensitiveWordProvider(['赌博', '洗钱'])]);
  return new ModerationService(new InMemoryModerationRepository(), provider, new FixedClock(NOW));
}

describe('ModerationService（US-024 自动审核）', () => {
  let service: ModerationService;

  beforeEach(() => {
    service = createService();
  });

  it('未命中敏感词时自动通过并直接记录 passed', async () => {
    const outcome = await service.reviewLetter('letter_1', { text: '你好，未来的自己', images: [] });
    expect(outcome.autoPassed).toBe(true);
    expect(outcome.record.decision).toBe('passed');
    expect(outcome.record.hits).toEqual([]);
    expect(outcome.record.resolvedAt?.getTime()).toBe(NOW.getTime());
    expect(await service.listQueue()).toHaveLength(0);
  });

  it('命中敏感词时进入待人工审核队列，命中明细只带位置不带正文', async () => {
    const text = '这是一封劝人赌博的信';
    const outcome = await service.reviewLetter('letter_2', { text, images: [] });
    expect(outcome.autoPassed).toBe(false);
    expect(outcome.record.decision).toBe('pending_human_review');
    expect(outcome.record.hits[0]).toEqual({
      rule: '赌博',
      category: 'sensitive_word',
      index: text.indexOf('赌博'),
    });
    // US-009：审核记录整体落库，序列化后不得出现正文上下文
    expect(JSON.stringify(outcome.record)).not.toContain('劝人');
    expect(outcome.record.providerResults).toEqual([{ provider: 'composite', passed: false }]);
    const queue = await service.listQueue();
    expect(queue.map((r) => r.letterId)).toEqual(['letter_2']);
  });

  it('人工审核通过：记录审核人与处理时间', async () => {
    const { record } = await service.reviewLetter('letter_3', { text: '涉赌博内容', images: [] });
    const resolved = await service.resolve(record.id, 'approve', 'admin_1');
    expect(resolved.decision).toBe('approved');
    expect(resolved.reviewerId).toBe('admin_1');
    expect(resolved.reason).toBeNull();
    expect(resolved.resolvedAt).not.toBeNull();
    expect(await service.listQueue()).toHaveLength(0);
  });

  it('人工审核驳回：必须填写原因', async () => {
    const { record } = await service.reviewLetter('letter_4', { text: '涉洗钱内容', images: [] });
    await expect(service.resolve(record.id, 'reject', 'admin_1')).rejects.toThrowError(
      /驳回时必须填写驳回原因/,
    );
    await expect(service.resolve(record.id, 'reject', 'admin_1', '   ')).rejects.toThrowError(
      /驳回时必须填写驳回原因/,
    );
    const resolved = await service.resolve(record.id, 'reject', 'admin_1', ' 疑似诈骗话术 ');
    expect(resolved.decision).toBe('rejected');
    expect(resolved.reason).toBe('疑似诈骗话术');
  });

  it('重复裁决返回 FORBIDDEN_STATE；记录不存在返回 NOT_FOUND', async () => {
    const { record } = await service.reviewLetter('letter_5', { text: '涉赌博', images: [] });
    await service.resolve(record.id, 'approve', 'admin_1');
    await expect(service.resolve(record.id, 'reject', 'admin_1', '重复操作')).rejects.toThrowError(
      /已处理/,
    );
    try {
      await service.resolve(record.id, 'reject', 'admin_1', '重复操作');
    } catch (error) {
      expect((error as AppError).code).toBe('FORBIDDEN_STATE');
    }
    try {
      await service.resolve('mod_not_exist', 'approve', 'admin_1');
      throw new Error('应当抛出未找到错误');
    } catch (error) {
      expect((error as AppError).code).toBe('NOT_FOUND');
    }
  });

  it('可按信笺反查审核记录', async () => {
    const { record } = await service.reviewLetter('letter_6', { text: '正常内容', images: [] });
    expect((await service.getByLetterId('letter_6'))?.id).toBe(record.id);
    expect(await service.getByLetterId('letter_404')).toBeNull();
  });
});
