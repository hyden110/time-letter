import type { Database } from '../../platform/database';
import type { RecipientRecord, RecipientRepository } from '../../recipients/recipients.repository';

interface RecipientRow {
  id: string;
  user_id: string;
  email: string;
  wechat_nickname: string | null;
  phone: string | null;
  is_self: boolean;
  created_at: Date;
}

const TABLE = 'recipients';

const INSERT_SQL = `
  INSERT INTO recipients (id, user_id, email, wechat_nickname, phone, is_self, created_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  RETURNING *
`;

function toRecord(row: RecipientRow): RecipientRecord {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    wechatNickname: row.wechat_nickname,
    phone: row.phone,
    isSelf: row.is_self,
    createdAt: row.created_at,
  };
}

/** PostgreSQL 收件人仓储（US-004）。收件人信息一期不做静态加密，仅信笺正文加密。 */
export class PgRecipientRepository implements RecipientRepository {
  constructor(private readonly db: Database) {}

  async create(record: RecipientRecord): Promise<RecipientRecord> {
    const result = await this.db.query<RecipientRow>(INSERT_SQL, [
      record.id,
      record.userId,
      record.email,
      record.wechatNickname,
      record.phone,
      record.isSelf,
      record.createdAt,
    ]);
    return toRecord(result.rows[0]);
  }

  async findById(id: string): Promise<RecipientRecord | null> {
    const result = await this.db.query<RecipientRow>(
      `SELECT * FROM ${TABLE} WHERE id = $1 LIMIT 1`,
      [id],
    );
    const row = result.rows[0];
    return row ? toRecord(row) : null;
  }

  async listByUser(userId: string): Promise<RecipientRecord[]> {
    const result = await this.db.query<RecipientRow>(
      `SELECT * FROM ${TABLE} WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    );
    return result.rows.map(toRecord);
  }
}
