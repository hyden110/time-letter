/** 查询结果（只读，避免调用方就地修改） */
export interface DatabaseRows<T> {
  readonly rows: readonly T[];
  readonly rowCount: number;
}

/**
 * 数据库访问抽象（平台层）。
 * 约定：一律使用 $n 占位符参数化查询，禁止把值拼接进 SQL 文本。
 */
export interface Database {
  query<T>(sql: string, params?: readonly unknown[]): Promise<DatabaseRows<T>>;
  /** 在同一连接上执行事务（迁移、多表写入用） */
  transaction<T>(work: (tx: Database) => Promise<T>): Promise<T>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

/** PostgreSQL 唯一约束冲突错误码 */
export const PG_UNIQUE_VIOLATION = '23505';

/**
 * 唯一约束冲突（对应 PG 23505）。
 * 保管编号 custody_code 依赖数据库唯一索引兜底，服务层捕获本错误后重试。
 */
export class UniqueConstraintError extends Error {
  constructor(
    readonly constraint: string | null,
    message = '唯一约束冲突',
  ) {
    super(message);
    this.name = 'UniqueConstraintError';
  }
}
