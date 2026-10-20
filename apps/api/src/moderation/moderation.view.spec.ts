import { describe, expect, it } from 'vitest';
import type { LetterRecord } from '../letters/letters.repository';
import type { ModerationHit, ModerationRecord } from './moderation.repository';
import { hitSnippet, toHitViews, toQueueItem } from './moderation.view';

const NOW = new Date('2026-10-08T10:00:00.000Z');

function hitOf(rule: string, index: number): ModerationHit {
  return { rule, category: 'sensitive_word', index };
}

function recordOf(hits: ModerationHit[]): ModerationRecord {
  return {
    id: 'mod_1',
    letterId: 'letter_1',
    decision: 'pending_human_review',
    hits,
    providerResults: [{ provider: 'composite', passed: false }],
    reviewerId: null,
    reason: null,
    createdAt: NOW,
    resolvedAt: null,
  };
}

function letterOf(text: string): LetterRecord {
  return {
    id: 'letter_1',
    userId: 'u1',
    letterType: 'electronic',
    sceneId: 'to_future_self',
    status: 'moderation_pending',
    content: { text, images: [] },
    deliveryDate: '2026-10-20',
    deliveryDateAdjustedFromFeb29: false,
    recipientId: 'rcpt_1',
    moderationRecordId: 'mod_1',
    custodyCode: null,
    custodyStartedAt: null,
    reviewReason: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe('审核命中片段的读取时重算（US-009）', () => {
  it('按 index 截取命中词前后各 5 字', () => {
    const text = '前言部分：我们来谈谈赌博这种行为的危害';
    expect(hitSnippet(text, hitOf('赌博', text.indexOf('赌博')))).toBe('我们来谈谈赌博这种行为的');
  });

  it('命中位于正文开头时左侧不越界', () => {
    expect(hitSnippet('赌博让人倾家荡产，别碰', hitOf('赌博', 0))).toBe('赌博让人倾家荡');
  });

  it('index 越界（正文已改写）时返回空串，不抛错', () => {
    expect(hitSnippet('短文本', hitOf('赌博', 99))).toBe('');
    expect(hitSnippet('短文本', hitOf('赌博', -1))).toBe('');
  });

  it('toQueueItem 给每条命中补上片段，且不修改入参审核记录', () => {
    const text = '这封信在讲赌博的故事';
    const index = text.indexOf('赌博');
    const record = recordOf([hitOf('赌博', index)]);

    const item = toQueueItem(record, letterOf(text));
    expect(item.record.hits).toEqual([
      { rule: '赌博', category: 'sensitive_word', index, snippet: '这封信在讲赌博的故事' },
    ]);
    expect(item.letter).toEqual({
      id: 'letter_1',
      userId: 'u1',
      status: 'moderation_pending',
      content: { text, images: [] },
      deliveryDate: '2026-10-20',
    });

    // 落库形态不变：审核记录自身没有 snippet 字段，片段只活在响应里
    expect(record.hits[0]).toEqual({ rule: '赌博', category: 'sensitive_word', index });
    expect(JSON.stringify(record)).not.toContain('snippet');
  });

  it('toHitViews 对空命中列表返回空数组', () => {
    expect(toHitViews('任意正文', [])).toEqual([]);
  });
});
