import type { LetterContent, LetterStatus, LetterType } from '@timeletter/shared';
import type { EncryptedEnvelope } from '../platform/content-cipher';
import { UniqueConstraintError } from '../platform/database';

export interface LetterRecord {
  id: string;
  userId: string;
  letterType: LetterType;
  sceneId: string | null;
  status: LetterStatus;
  content: LetterContent;
  /** YYYY-MM-DD；未选择时 null */
  deliveryDate: string | null;
  /** 选择 2月29日且顺延至 3月1日时为 true（确认页需注明） */
  deliveryDateAdjustedFromFeb29: boolean;
  recipientId: string | null;
  moderationRecordId: string | null;
  /** 保管编号 SJ-YYYYMMDD-XXXX（进入保管时生成） */
  custodyCode: string | null;
  custodyStartedAt: Date | null;
  /** 审核驳回/抽检冻结原因 */
  reviewReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 落库形态（US-009）：正文只允许以 AES-256-GCM 密文信封存储。
 * 服务层负责 encrypt/decrypt，仓储与数据库都看不到明文。
 */
export type StoredLetterRecord = Omit<LetterRecord, 'content'> & {
  content: EncryptedEnvelope;
};

export interface LetterRepository {
  create(record: StoredLetterRecord): Promise<StoredLetterRecord>;
  findById(id: string): Promise<StoredLetterRecord | null>;
  update(id: string, patch: Partial<StoredLetterRecord>): Promise<StoredLetterRecord | null>;
  listByUser(userId: string): Promise<StoredLetterRecord[]>;
}

/** 保管编号唯一索引名（与 PG 的 letters_custody_code_key 一致） */
const CUSTODY_CODE_CONSTRAINT = 'letters_custody_code_key';

/**
 * 开发期/单测内存实现。
 * custody_code 的唯一性由数据库唯一索引兜底，这里做等价校验，
 * 使冲突重试路径在不依赖数据库时也能被测到。
 */
export class InMemoryLetterRepository implements LetterRepository {
  private readonly store = new Map<string, StoredLetterRecord>();

  async create(record: StoredLetterRecord): Promise<StoredLetterRecord> {
    this.assertCustodyCodeFree(record);
    this.store.set(record.id, structuredClone(record));
    return structuredClone(record);
  }

  async findById(id: string): Promise<StoredLetterRecord | null> {
    const record = this.store.get(id);
    return record ? structuredClone(record) : null;
  }

  async update(
    id: string,
    patch: Partial<StoredLetterRecord>,
  ): Promise<StoredLetterRecord | null> {
    const current = this.store.get(id);
    if (!current) {
      return null;
    }
    const updated: StoredLetterRecord = { ...current, ...patch, id: current.id };
    this.assertCustodyCodeFree(updated);
    this.store.set(id, structuredClone(updated));
    return structuredClone(updated);
  }

  async listByUser(userId: string): Promise<StoredLetterRecord[]> {
    return [...this.store.values()]
      .filter((record) => record.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((record) => structuredClone(record));
  }

  /** 等价于 PG 唯一索引：同一保管编号不允许出现在两封信笺上 */
  private assertCustodyCodeFree(record: StoredLetterRecord): void {
    if (record.custodyCode === null) {
      return;
    }
    const clash = [...this.store.values()].some(
      (item) => item.custodyCode === record.custodyCode && item.id !== record.id,
    );
    if (clash) {
      throw new UniqueConstraintError(CUSTODY_CODE_CONSTRAINT);
    }
  }
}
