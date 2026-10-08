import type { ModerationDecision } from '@timeletter/shared';

export interface ModerationHit {
  /** 命中的规则/词条来源，例如敏感词库词条或微信 API 返回的 label */
  rule: string;
  /** 命中片段（用于人工审核展示命中原因） */
  snippet: string;
  /** 命中分类，例如 'sensitive_word' | 'wechat_sec_check' */
  category: string;
}

export interface ModerationRecord {
  id: string;
  letterId: string;
  decision: ModerationDecision;
  /** 自动审核命中的明细，空数组表示未命中 */
  hits: ModerationHit[];
  /** 各审核通道结果（敏感词库 / 微信内容安全 API） */
  providerResults: Array<{ provider: string; passed: boolean }>;
  /** 人工审核人 */
  reviewerId: string | null;
  /** 人工审核意见（驳回时必填） */
  reason: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface ModerationRepository {
  create(record: ModerationRecord): Promise<ModerationRecord>;
  findById(id: string): Promise<ModerationRecord | null>;
  findByLetterId(letterId: string): Promise<ModerationRecord | null>;
  /** 按决定筛选（人工审核队列 = pending_human_review） */
  listByDecision(decision: ModerationDecision): Promise<ModerationRecord[]>;
  update(id: string, patch: Partial<ModerationRecord>): Promise<ModerationRecord | null>;
}

/** 开发期内存实现；PostgreSQL 适配器 Sprint 1.2 接入（接口保持不变） */
export class InMemoryModerationRepository implements ModerationRepository {
  private readonly store = new Map<string, ModerationRecord>();

  async create(record: ModerationRecord): Promise<ModerationRecord> {
    this.store.set(record.id, structuredClone(record));
    return structuredClone(record);
  }

  async findById(id: string): Promise<ModerationRecord | null> {
    const record = this.store.get(id);
    return record ? structuredClone(record) : null;
  }

  async findByLetterId(letterId: string): Promise<ModerationRecord | null> {
    const record = [...this.store.values()].find((item) => item.letterId === letterId);
    return record ? structuredClone(record) : null;
  }

  async listByDecision(decision: ModerationDecision): Promise<ModerationRecord[]> {
    return [...this.store.values()]
      .filter((record) => record.decision === decision)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((record) => structuredClone(record));
  }

  async update(id: string, patch: Partial<ModerationRecord>): Promise<ModerationRecord | null> {
    const current = this.store.get(id);
    if (!current) {
      return null;
    }
    const updated: ModerationRecord = { ...current, ...patch, id: current.id };
    this.store.set(id, structuredClone(updated));
    return structuredClone(updated);
  }
}
