import { describe, expect, it } from 'vitest';
import { buildUpdate, toJsonb, toDateOnly, type ColumnWhitelist } from './pg-update';

interface Sample {
  id: string;
  userId: string;
  status: string;
  custodyCode: string | null;
  hits: string[];
  updatedAt: Date;
}

const WHITELIST: ColumnWhitelist<Sample> = {
  status: { column: 'status', toDb: (value) => value },
  custodyCode: { column: 'custody_code', toDb: (value) => value },
  hits: { column: 'hits', toDb: toJsonb },
  updatedAt: { column: 'updated_at', toDb: (value) => value },
};

function planFor(patch: Partial<Sample>) {
  return buildUpdate<Sample>({
    table: 'samples',
    idColumn: 'id',
    id: 'sample_1',
    whitelist: WHITELIST,
    patch,
  });
}

describe('buildUpdate：动态 UPDATE 只允许白名单列 + 参数化占位符', () => {
  it('按 patch 生成 SET 子句，id 永远是最后一个参数，并带 RETURNING *', () => {
    const at = new Date(2026, 8, 30, 10, 0, 0);
    const plan = planFor({ status: 'in_custody', updatedAt: at });
    expect(plan.sql).toBe(
      'UPDATE samples SET status = $1, updated_at = $2 WHERE id = $3 RETURNING *',
    );
    expect(plan.values).toEqual(['in_custody', at, 'sample_1']);
  });

  it('null 表示清空字段（参与 SET），undefined 表示不改（跳过）', () => {
    const plan = planFor({ custodyCode: null, hits: undefined });
    expect(plan.sql).toBe('UPDATE samples SET custody_code = $1 WHERE id = $2 RETURNING *');
    expect(plan.values).toEqual([null, 'sample_1']);
  });

  it('jsonb 字段写入前序列化为字符串，避免被当成 PG 数组字面量', () => {
    expect(planFor({ hits: ['赌博'] }).values[0]).toBe('["赌博"]');
  });

  it('白名单外的字段（如主键/归属用户）显式报错，不静默忽略', () => {
    expect(() => planFor({ id: 'hacked' })).toThrowError(
      /UNSUPPORTED_FIELD: samples\.id 不可更新/,
    );
    expect(() => planFor({ userId: 'u2' })).toThrowError(
      /UNSUPPORTED_FIELD: samples\.userId 不可更新/,
    );
  });

  it('没有任何可更新字段时报 EMPTY_UPDATE，不生成残缺 SQL', () => {
    expect(() => planFor({ hits: undefined })).toThrowError(
      /EMPTY_UPDATE: samples 没有需要更新的字段/,
    );
  });
});

describe('toDateOnly：date 列还原为 YYYY-MM-DD（不受时区偏移影响）', () => {
  it('字符串直接截断', () => {
    expect(toDateOnly('2027-03-01')).toBe('2027-03-01');
    expect(toDateOnly('2027-03-01T00:00:00.000Z')).toBe('2027-03-01');
  });

  it('Date 按本地分量格式化，2月29日顺延结果不回退一天', () => {
    expect(toDateOnly(new Date(2027, 2, 1))).toBe('2027-03-01');
    expect(toDateOnly(new Date(2028, 1, 29))).toBe('2028-02-29');
    expect(toDateOnly(new Date(2026, 9, 20))).toBe('2026-10-20');
  });
});
