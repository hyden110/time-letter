import type { OrderStatus } from '@timeletter/shared';
import type { Database } from '../../platform/database';
import type { OrderRecord, OrderRepository } from '../../orders/orders.repository';

interface OrderRow {
  id: string;
  user_id: string;
  letter_id: string;
  amount_cents: number;
  status: OrderStatus;
  created_at: Date;
}

const TABLE = 'orders';

const INSERT_SQL = `
  INSERT INTO orders (id, user_id, letter_id, amount_cents, status, created_at)
  VALUES ($1, $2, $3, $4, $5, $6)
  RETURNING *
`;

function toRecord(row: OrderRow): OrderRecord {
  return {
    id: row.id,
    userId: row.user_id,
    letterId: row.letter_id,
    amountCents: row.amount_cents,
    status: row.status,
    createdAt: row.created_at,
  };
}

/**
 * PostgreSQL 订单仓储。一封信笺只允许一条订单，由 orders.letter_id 唯一索引保证，
 * 重复提交会转成 UniqueConstraintError 显式失败而不是静默覆盖。
 */
export class PgOrderRepository implements OrderRepository {
  constructor(private readonly db: Database) {}

  async create(order: OrderRecord): Promise<OrderRecord> {
    const result = await this.db.query<OrderRow>(INSERT_SQL, [
      order.id,
      order.userId,
      order.letterId,
      order.amountCents,
      order.status,
      order.createdAt,
    ]);
    return toRecord(result.rows[0]);
  }

  async findById(id: string): Promise<OrderRecord | null> {
    const result = await this.db.query<OrderRow>(
      `SELECT * FROM ${TABLE} WHERE id = $1 LIMIT 1`,
      [id],
    );
    const row = result.rows[0];
    return row ? toRecord(row) : null;
  }

  async findByLetterId(letterId: string): Promise<OrderRecord | null> {
    const result = await this.db.query<OrderRow>(
      `SELECT * FROM ${TABLE} WHERE letter_id = $1 LIMIT 1`,
      [letterId],
    );
    const row = result.rows[0];
    return row ? toRecord(row) : null;
  }

  async listByUser(userId: string): Promise<OrderRecord[]> {
    const result = await this.db.query<OrderRow>(
      `SELECT * FROM ${TABLE} WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    );
    return result.rows.map(toRecord);
  }
}
