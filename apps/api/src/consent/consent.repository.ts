import type { ConsentType } from '@timeletter/shared';

export interface ConsentRecord {
  id: string;
  userId: string;
  type: ConsentType;
  /** 协议版本；版本升级时旧记录被撤回、新记录生效 */
  version: string;
  grantedAt: Date;
  withdrawnAt: Date | null;
  /** 授权来源：mini_program / admin / import 等 */
  source: string;
}

export interface ConsentRepository {
  create(record: ConsentRecord): Promise<ConsentRecord>;
  findById(id: string): Promise<ConsentRecord | null>;
  findActive(userId: string, type: ConsentType): Promise<ConsentRecord | null>;
  listByUser(userId: string): Promise<ConsentRecord[]>;
  withdraw(id: string, withdrawnAt: Date): Promise<ConsentRecord | null>;
}

export class InMemoryConsentRepository implements ConsentRepository {
  private readonly store = new Map<string, ConsentRecord>();

  async create(record: ConsentRecord): Promise<ConsentRecord> {
    this.store.set(record.id, structuredClone(record));
    return structuredClone(record);
  }

  async findById(id: string): Promise<ConsentRecord | null> {
    const record = this.store.get(id);
    return record ? structuredClone(record) : null;
  }

  async findActive(userId: string, type: ConsentType): Promise<ConsentRecord | null> {
    const record = [...this.store.values()].find(
      (item) => item.userId === userId && item.type === type && item.withdrawnAt === null,
    );
    return record ? structuredClone(record) : null;
  }

  async listByUser(userId: string): Promise<ConsentRecord[]> {
    return [...this.store.values()]
      .filter((record) => record.userId === userId)
      .sort((a, b) => a.grantedAt.getTime() - b.grantedAt.getTime())
      .map((record) => structuredClone(record));
  }

  async withdraw(id: string, withdrawnAt: Date): Promise<ConsentRecord | null> {
    const current = this.store.get(id);
    if (!current || current.withdrawnAt !== null) {
      return null;
    }
    const updated: ConsentRecord = { ...current, withdrawnAt };
    this.store.set(id, structuredClone(updated));
    return structuredClone(updated);
  }
}
