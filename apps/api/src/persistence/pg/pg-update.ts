/**
 * PostgreSQL 动态 UPDATE 构造器。
 *
 * 安全约束：表名/列名只来自代码常量（whitelist），值一律通过 $n 占位符参数化传递，
 * 任何调用方传入的数据都不会被拼接进 SQL 文本。
 */

export interface UpdatePlan {
  readonly sql: string;
  readonly values: readonly unknown[];
}

/** 单个可更新字段：领域字段 → 数据库列名 + 序列化器 */
export interface UpdatableColumn<V> {
  readonly column: string;
  readonly toDb: (value: V) => unknown;
}

export type ColumnWhitelist<R> = {
  readonly [K in keyof R]?: UpdatableColumn<R[K]>;
};

export interface BuildUpdateInput<R> {
  readonly table: string;
  readonly idColumn: string;
  readonly id: string;
  readonly whitelist: ColumnWhitelist<R>;
  readonly patch: Partial<R>;
}

/**
 * 按白名单生成 `UPDATE ... SET ... WHERE id = $n RETURNING *`。
 * patch 中出现白名单之外的字段（例如 id）视为编码错误，显式抛出而不是静默忽略。
 */
export function buildUpdate<R extends object>(input: BuildUpdateInput<R>): UpdatePlan {
  const { table, idColumn, id, whitelist, patch } = input;
  const values: unknown[] = [];
  const assignments: string[] = [];
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }
    const column = whitelist[field as keyof R];
    if (!column) {
      throw new Error(`UNSUPPORTED_FIELD: ${table}.${field} 不可更新`);
    }
    values.push(column.toDb(value as R[keyof R]));
    assignments.push(`${column.column} = $${values.length}`);
  }
  if (assignments.length === 0) {
    throw new Error(`EMPTY_UPDATE: ${table} 没有需要更新的字段`);
  }
  values.push(id);
  return {
    sql: `UPDATE ${table} SET ${assignments.join(', ')} WHERE ${idColumn} = $${values.length} RETURNING *`,
    values,
  };
}

/**
 * PostgreSQL `date` 列 → 领域层的 YYYY-MM-DD 字符串。
 * node-pg 默认把 date 解析成本地零点的 Date，这里按本地分量还原，避免时区偏移改日期。
 */
export function toDateOnly(value: string | Date): string {
  if (typeof value === 'string') {
    return value.slice(0, 10);
  }
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** jsonb 写入前的统一序列化：避免 node-pg 把 JS 数组当成 PG 数组字面量 */
export function toJsonb(value: unknown): string {
  return JSON.stringify(value);
}
