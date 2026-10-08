import type { ModerationDecision } from '@timeletter/shared';
import type { Database } from '../../platform/database';
import type {
  ModerationHit,
  ModerationRecord,
  ModerationRepository,
} from '../../moderation/moderation.repository';
import { buildUpdate, toJsonb, type ColumnWhitelist } from './pg-update';

interface ModerationRow {
  id: string;
  letter_id: string;
  decision: ModerationDecision;
  hits: ModerationHit[];
  provider_results: Array<{ provider: string; passed: boolean }>;
  reviewer_id: string | null;
  reason: string | null;
  created_at: Date;
  resolved_at: Date | null;
}

const TABLE = 'moderation_records';

const INSERT_SQL = `
  INSERT INTO moderation_records (
    id, letter_id, decision, hits, provider_results, reviewer_id, reason, created_at, resolved_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  RETURNING *
`;

/** 可更新字段白名单：人工裁决只改结论、审核人、原因与裁决时间 */
const UPDATABLE: ColumnWhitelist<ModerationRecord> = {
  decision: { column: 'decision', toDb: (value) => value },
  hits: { column: 'hits', toDb: toJsonb },
  providerResults: { column: 'provider_results', toDb: toJsonb },
  reviewerId: { column: 'reviewer_id', toDb: (value) => value },
  reason: { column: 'reason', toDb: (value) => value },
  resolvedAt: { column: 'resolved_at', toDb: (value) => value },
};

function toRecord(row: ModerationRow): ModerationRecord {
  return {
    id: row.id,
    letterId: row.letter_id,
    decision: row.decision,
    hits: row.hits,
    providerResults: row.provider_results,
    reviewerId: row.reviewer_id,
    reason: row.reason,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

/** PostgreSQL 内容审核记录仓储（US-024） */
export class PgModerationRepository implements ModerationRepository {
  constructor(private readonly db: Database) {}

  async create(record: ModerationRecord): Promise<ModerationRecord> {
    const result = await this.db.query<ModerationRow>(INSERT_SQL, [
      record.id,
      record.letterId,
      record.decision,
      toJsonb(record.hits),
      toJsonb(record.providerResults),
      record.reviewerId,
      record.reason,
      record.createdAt,
      record.resolvedAt,
    ]);
    return toRecord(result.rows[0]);
  }

  async findById(id: string): Promise<ModerationRecord | null> {
    const result = await this.db.query<ModerationRow>(
      `SELECT * FROM ${TABLE} WHERE id = $1 LIMIT 1`,
      [id],
    );
    const row = result.rows[0];
    return row ? toRecord(row) : null;
  }

  async findByLetterId(letterId: string): Promise<ModerationRecord | null> {
    const result = await this.db.query<ModerationRow>(
      `SELECT * FROM ${TABLE} WHERE letter_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [letterId],
    );
    const row = result.rows[0];
    return row ? toRecord(row) : null;
  }

  async listByDecision(decision: ModerationDecision): Promise<ModerationRecord[]> {
    const result = await this.db.query<ModerationRow>(
      `SELECT * FROM ${TABLE} WHERE decision = $1 ORDER BY created_at ASC`,
      [decision],
    );
    return result.rows.map(toRecord);
  }

  async update(id: string, patch: Partial<ModerationRecord>): Promise<ModerationRecord | null> {
    const plan = buildUpdate<ModerationRecord>({
      table: TABLE,
      idColumn: 'id',
      id,
      whitelist: UPDATABLE,
      patch,
    });
    const result = await this.db.query<ModerationRow>(plan.sql, plan.values);
    const row = result.rows[0];
    return row ? toRecord(row) : null;
  }
}
