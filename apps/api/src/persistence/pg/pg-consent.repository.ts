import type { ConsentType } from '@timeletter/shared';
import type { Database } from '../../platform/database';
import type { ConsentRecord, ConsentRepository } from '../../consent/consent.repository';

interface ConsentRow {
  id: string;
  user_id: string;
  type: ConsentType;
  version: string;
  granted_at: Date;
  withdrawn_at: Date | null;
  source: string;
}

const TABLE = 'consents';

const INSERT_SQL = `
  INSERT INTO consents (id, user_id, type, version, granted_at, withdrawn_at, source)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  RETURNING *
`;

function toRecord(row: ConsentRow): ConsentRecord {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    version: row.version,
    grantedAt: row.granted_at,
    withdrawnAt: row.withdrawn_at,
    source: row.source,
  };
}

/**
 * PostgreSQL 同意记录仓储（US-032）。
 * 同一 user_id + type 只允许一条未撤回记录，由唯一部分索引 consents_active_key 保证。
 */
export class PgConsentRepository implements ConsentRepository {
  constructor(private readonly db: Database) {}

  async create(record: ConsentRecord): Promise<ConsentRecord> {
    const result = await this.db.query<ConsentRow>(INSERT_SQL, [
      record.id,
      record.userId,
      record.type,
      record.version,
      record.grantedAt,
      record.withdrawnAt,
      record.source,
    ]);
    return toRecord(result.rows[0]);
  }

  async findById(id: string): Promise<ConsentRecord | null> {
    const result = await this.db.query<ConsentRow>(
      `SELECT * FROM ${TABLE} WHERE id = $1 LIMIT 1`,
      [id],
    );
    const row = result.rows[0];
    return row ? toRecord(row) : null;
  }

  async findActive(userId: string, type: ConsentType): Promise<ConsentRecord | null> {
    const result = await this.db.query<ConsentRow>(
      `SELECT * FROM ${TABLE}
       WHERE user_id = $1 AND type = $2 AND withdrawn_at IS NULL
       ORDER BY granted_at DESC
       LIMIT 1`,
      [userId, type],
    );
    const row = result.rows[0];
    return row ? toRecord(row) : null;
  }

  async listByUser(userId: string): Promise<ConsentRecord[]> {
    const result = await this.db.query<ConsentRow>(
      `SELECT * FROM ${TABLE} WHERE user_id = $1 ORDER BY granted_at ASC`,
      [userId],
    );
    return result.rows.map(toRecord);
  }

  /** 撤回有效同意；已撤回或不存在时返回 null（与内存实现语义一致） */
  async withdraw(id: string, withdrawnAt: Date): Promise<ConsentRecord | null> {
    const result = await this.db.query<ConsentRow>(
      `UPDATE ${TABLE} SET withdrawn_at = $1 WHERE id = $2 AND withdrawn_at IS NULL RETURNING *`,
      [withdrawnAt, id],
    );
    const row = result.rows[0];
    return row ? toRecord(row) : null;
  }
}
