import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Database } from '../platform/database';

export interface MigrationFile {
  /** 文件名（含 .sql），按字典序即执行顺序 */
  name: string;
  sql: string;
}

const MIGRATIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;

/** 兼容源码运行（apps/api）、编译产物运行（apps/api/dist/persistence）与仓库根运行 */
const MIGRATIONS_DIR_CANDIDATES = [
  'db/migrations',
  'apps/api/db/migrations',
  '../db/migrations',
  '../../db/migrations',
  '../../../db/migrations',
] as const;

/** 定位迁移目录；找不到时显式报错（避免静默「无迁移可执行」） */
export function resolveMigrationsDir(cwd: string = process.cwd()): string {
  for (const candidate of MIGRATIONS_DIR_CANDIDATES) {
    const dir = resolve(cwd, candidate);
    if (existsSync(dir)) {
      return dir;
    }
  }
  throw new Error(
    `MIGRATIONS_DIR_NOT_FOUND: 未找到 db/migrations（cwd=${cwd}，已尝试 ${MIGRATIONS_DIR_CANDIDATES.join(', ')}）`,
  );
}

export function readMigrationFiles(dir: string = resolveMigrationsDir()): MigrationFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
}

/**
 * 按文件名顺序应用尚未执行的迁移，已应用记录写入 schema_migrations。
 * 全部迁移在一个事务内完成，任一步失败整体回滚。
 * 迁移 SQL 来自仓库内受控文件（非外部输入），DDL 无法参数化；业务数据一律走 $n 占位符。
 */
export async function runMigrations(
  db: Database,
  files: MigrationFile[] = readMigrationFiles(),
): Promise<string[]> {
  await db.query(MIGRATIONS_TABLE_SQL);
  const applied: string[] = [];
  await db.transaction(async (tx) => {
    for (const file of files) {
      const existing = await tx.query<{ name: string }>(
        'SELECT name FROM schema_migrations WHERE name = $1',
        [file.name],
      );
      if (existing.rows.length > 0) {
        continue;
      }
      await tx.query(file.sql);
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file.name]);
      applied.push(file.name);
    }
  });
  return applied;
}
