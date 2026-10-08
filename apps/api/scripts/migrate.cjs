#!/usr/bin/env node
/**
 * 数据库迁移执行器（Sprint 1.2-A）。
 *
 * 用法：DATABASE_URL=postgres://... node scripts/migrate.cjs
 * 说明：这里直接读 DATABASE_URL，不走 loadEnv()，
 * 因此执行迁移不需要 LETTER_ENCRYPTION_KEY 等业务配置。
 * 依赖 dist 产物，请先 `pnpm run build`（package.json 的 migrate 脚本已包含）。
 */
'use strict';

const { PgDatabase } = require('../dist/platform/pg-database.js');
const { runMigrations } = require('../dist/persistence/migrate.js');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || connectionString.trim() === '') {
    throw new Error('INVALID_ENV: DATABASE_URL 未配置，无法执行迁移');
  }
  const db = new PgDatabase({ connectionString: connectionString.trim() });
  try {
    await db.ping();
    const applied = await runMigrations(db);
    if (applied.length === 0) {
      console.log('[migrate] 无新迁移需要执行（schema_migrations 已是最新）');
    } else {
      console.log(`[migrate] 已应用 ${applied.length} 个迁移：${applied.join(', ')}`);
    }
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(`[migrate] 失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
