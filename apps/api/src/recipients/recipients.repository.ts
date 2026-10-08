export interface RecipientRecord {
  id: string;
  userId: string;
  email: string;
  wechatNickname: string | null;
  /** 一期选填；实体信笺阶段必填 */
  phone: string | null;
  /** 寄给自己时跳过第三方信息授权（PIPL 单独同意不适用于本人信息） */
  isSelf: boolean;
  createdAt: Date;
}

export interface RecipientRepository {
  create(record: RecipientRecord): Promise<RecipientRecord>;
  findById(id: string): Promise<RecipientRecord | null>;
  listByUser(userId: string): Promise<RecipientRecord[]>;
}

export class InMemoryRecipientRepository implements RecipientRepository {
  private readonly store = new Map<string, RecipientRecord>();

  async create(record: RecipientRecord): Promise<RecipientRecord> {
    this.store.set(record.id, structuredClone(record));
    return structuredClone(record);
  }

  async findById(id: string): Promise<RecipientRecord | null> {
    const record = this.store.get(id);
    return record ? structuredClone(record) : null;
  }

  async listByUser(userId: string): Promise<RecipientRecord[]> {
    return [...this.store.values()]
      .filter((record) => record.userId === userId)
      .map((record) => structuredClone(record));
  }
}
