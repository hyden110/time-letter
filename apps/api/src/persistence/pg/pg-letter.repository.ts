import type { LetterStatus, LetterType } from '@timeletter/shared';
import type { EncryptedEnvelope } from '../../platform/content-cipher';
import type { Database } from '../../platform/database';
import type { LetterRepository, StoredLetterRecord } from '../../letters/letters.repository';
import { buildUpdate, toJsonb, toDateOnly, type ColumnWhitelist } from './pg-update';

/** letters 表行形态（列名与 001_init.sql 一致） */
interface LetterRow {
  id: string;
  user_id: string;
  letter_type: LetterType;
  scene_id: string | null;
  status: LetterStatus;
  content: EncryptedEnvelope;
  delivery_date: string | Date | null;
  delivery_date_adjusted_from_feb29: boolean;
  recipient_id: string | null;
  moderation_record_id: string | null;
  custody_code: string | null;
  custody_started_at: Date | null;
  review_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

const TABLE = 'letters';

const INSERT_SQL = `
  INSERT INTO letters (
    id, user_id, letter_type, scene_id, status, content,
    delivery_date, delivery_date_adjusted_from_feb29, recipient_id, moderation_record_id,
    custody_code, custody_started_at, review_reason, created_at, updated_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
  RETURNING *
`;

/** 可更新字段白名单：id/user_id/created_at 一经写入不可改，故不在表内 */
const UPDATABLE: ColumnWhitelist<StoredLetterRecord> = {
  status: { column: 'status', toDb: (value) => value },
  content: { column: 'content', toDb: toJsonb },
  deliveryDate: { column: 'delivery_date', toDb: (value) => value },
  deliveryDateAdjustedFromFeb29: {
    column: 'delivery_date_adjusted_from_feb29',
    toDb: (value) => value,
  },
  recipientId: { column: 'recipient_id', toDb: (value) => value },
  moderationRecordId: { column: 'moderation_record_id', toDb: (value) => value },
  custodyCode: { column: 'custody_code', toDb: (value) => value },
  custodyStartedAt: { column: 'custody_started_at', toDb: (value) => value },
  reviewReason: { column: 'review_reason', toDb: (value) => value },
  updatedAt: { column: 'updated_at', toDb: (value) => value },
};

function toRecord(row: LetterRow): StoredLetterRecord {
  return {
    id: row.id,
    userId: row.user_id,
    letterType: row.letter_type,
    sceneId: row.scene_id,
    status: row.status,
    content: row.content,
    deliveryDate: row.delivery_date === null ? null : toDateOnly(row.delivery_date),
    deliveryDateAdjustedFromFeb29: row.delivery_date_adjusted_from_feb29,
    recipientId: row.recipient_id,
    moderationRecordId: row.moderation_record_id,
    custodyCode: row.custody_code,
    custodyStartedAt: row.custody_started_at,
    reviewReason: row.review_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * PostgreSQL 信笺仓储。正文以密文信封（jsonb）落库，仓储层不做加解密。
 * custody_code 唯一性由数据库唯一索引 letters_custody_code_key 兜底，
 * 冲突时由 PgDatabase 转成 UniqueConstraintError 交服务层换号重试。
 */
export class PgLetterRepository implements LetterRepository {
  constructor(private readonly db: Database) {}

  async create(record: StoredLetterRecord): Promise<StoredLetterRecord> {
    const result = await this.db.query<LetterRow>(INSERT_SQL, [
      record.id,
      record.userId,
      record.letterType,
      record.sceneId,
      record.status,
      toJsonb(record.content),
      record.deliveryDate,
      record.deliveryDateAdjustedFromFeb29,
      record.recipientId,
      record.moderationRecordId,
      record.custodyCode,
      record.custodyStartedAt,
      record.reviewReason,
      record.createdAt,
      record.updatedAt,
    ]);
    return toRecord(result.rows[0]);
  }

  async findById(id: string): Promise<StoredLetterRecord | null> {
    const result = await this.db.query<LetterRow>(
      `SELECT * FROM ${TABLE} WHERE id = $1 LIMIT 1`,
      [id],
    );
    const row = result.rows[0];
    return row ? toRecord(row) : null;
  }

  async update(
    id: string,
    patch: Partial<StoredLetterRecord>,
  ): Promise<StoredLetterRecord | null> {
    const plan = buildUpdate<StoredLetterRecord>({
      table: TABLE,
      idColumn: 'id',
      id,
      whitelist: UPDATABLE,
      patch,
    });
    const result = await this.db.query<LetterRow>(plan.sql, plan.values);
    const row = result.rows[0];
    return row ? toRecord(row) : null;
  }

  async listByUser(userId: string): Promise<StoredLetterRecord[]> {
    const result = await this.db.query<LetterRow>(
      `SELECT * FROM ${TABLE} WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    );
    return result.rows.map(toRecord);
  }
}
