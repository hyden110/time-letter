import { Pool, type PoolClient } from 'pg';
import {
  PG_UNIQUE_VIOLATION,
  UniqueConstraintError,
  type Database,
  type DatabaseRows,
} from './database';

export interface PgDatabaseOptions {
  connectionString: string;
  /** 连接池上限；一期单机默认 5 */
  maxConnections?: number;
}

/** 把驱动错误翻译成领域错误：目前只识别唯一约束冲突，其余原样抛出 */
function toDatabaseError(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) {
    return error;
  }
  const candidate = error as { code?: unknown; constraint?: unknown };
  if (candidate.code !== PG_UNIQUE_VIOLATION) {
    return error;
  }
  const constraint = typeof candidate.constraint === 'string' ? candidate.constraint : null;
  return new UniqueConstraintError(constraint);
}

function toRows<T>(rows: unknown[], rowCount: number | null): DatabaseRows<T> {
  return { rows: rows as readonly T[], rowCount: rowCount ?? rows.length };
}

/**
 * 归一化 node-pg 的返回：一条 SQL 里含多个语句时（simple query，典型是迁移 DDL），
 * 驱动返回的是「结果数组」而不是单个结果对象，直接取 .rows 会得到 undefined。
 * 这里统一取最后一个结果集；DDL 没有行数据，退化为空结果。
 */
function normalizePgResult(result: unknown): { rows: unknown[]; rowCount: number | null } {
  const candidate = Array.isArray(result) ? result[result.length - 1] : result;
  if (typeof candidate !== 'object' || candidate === null) {
    return { rows: [], rowCount: null };
  }
  const shape = candidate as { rows?: unknown; rowCount?: unknown };
  return {
    rows: Array.isArray(shape.rows) ? shape.rows : [],
    rowCount: typeof shape.rowCount === 'number' ? shape.rowCount : null,
  };
}

/** 事务内的 Database 视图：绑定单个客户端连接 */
class TransactionDatabase implements Database {
  constructor(private readonly client: PoolClient) {}

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<DatabaseRows<T>> {
    try {
      const result = normalizePgResult(await this.client.query(sql, [...params]));
      return toRows<T>(result.rows, result.rowCount);
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
    // 已在事务中：复用同一连接，不嵌套 BEGIN
    return work(this);
  }

  async ping(): Promise<void> {
    await this.query('SELECT 1');
  }

  async close(): Promise<void> {
    this.client.release();
  }
}

/**
 * PostgreSQL 连接管理（平台层）。
 * 只暴露参数化查询；连接池生命周期由 Nest 的 onModuleDestroy 收尾。
 */
export class PgDatabase implements Database {
  private readonly pool: Pool;

  constructor(options: PgDatabaseOptions) {
    this.pool = new Pool({
      connectionString: options.connectionString,
      max: options.maxConnections ?? 5,
    });
  }

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<DatabaseRows<T>> {
    try {
      const result = normalizePgResult(await this.pool.query(sql, [...params]));
      return toRows<T>(result.rows, result.rowCount);
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(new TransactionDatabase(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    await this.query('SELECT 1');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /** Nest 生命周期钩子：应用关闭时释放连接池 */
  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}
