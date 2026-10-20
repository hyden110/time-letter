import type { LetterRecord } from '../letters/letters.repository';
import type { ModerationHit, ModerationRecord } from './moderation.repository';

/**
 * 审核记录的「读取时视图」。
 *
 * US-009 要求信件正文明文不进数据库，因此落库的命中明细只有 {rule, category, index}；
 * 人工审核需要的命中片段在这里按「已解密正文」现场重算，只存在于响应中，不写回仓储。
 */

/** 命中片段上下文：命中词前后各 5 字（与自动审核原口径一致） */
const SNIPPET_CONTEXT_CHARS = 5;

export interface ModerationHitView extends ModerationHit {
  /** 读取时重算的命中片段；index 越界（正文已变更）时为空串 */
  snippet: string;
}

export type ModerationRecordView = Omit<ModerationRecord, 'hits'> & {
  hits: ModerationHitView[];
};

export interface ModerationQueueItem {
  record: ModerationRecordView;
  letter: {
    id: string;
    userId: string;
    status: LetterRecord['status'];
    content: LetterRecord['content'];
    deliveryDate: string | null;
  };
}

/**
 * 按命中位置截取上下文片段。
 * index 越界时返回空串：正文可能已被用户改写，此时不猜片段、也不抛错，审核仍能看到 rule 与位置。
 */
export function hitSnippet(text: string, hit: ModerationHit): string {
  if (hit.index < 0 || hit.index >= text.length) {
    return '';
  }
  const start = Math.max(0, hit.index - SNIPPET_CONTEXT_CHARS);
  return text.slice(start, hit.index + hit.rule.length + SNIPPET_CONTEXT_CHARS);
}

/** 落库明细 → 展示明细：逐条补上重算后的片段（不修改入参） */
export function toHitViews(text: string, hits: readonly ModerationHit[]): ModerationHitView[] {
  return hits.map((hit) => ({ ...hit, snippet: hitSnippet(text, hit) }));
}

/** 人工审核队列条目：审核记录（含重算片段）+ 信笺摘要（正文为解密后的明文） */
export function toQueueItem(record: ModerationRecord, letter: LetterRecord): ModerationQueueItem {
  const { hits, ...rest } = record;
  return {
    record: { ...rest, hits: toHitViews(letter.content.text, hits) },
    letter: {
      id: letter.id,
      userId: letter.userId,
      status: letter.status,
      content: letter.content,
      deliveryDate: letter.deliveryDate,
    },
  };
}
