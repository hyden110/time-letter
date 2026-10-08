import 'reflect-metadata';
import { randomBytes } from 'node:crypto';

/**
 * 集成测试环境（真基础设施）：固定连 PostgreSQL。
 * 由 vitest.integration.config.ts 在 test/setup.ts 之后加载，覆盖其内存模式默认值。
 */
process.env.STORAGE_MODE = 'postgres';

// docker compose 起的本地实例；CI/ECS 上由环境变量覆盖
process.env.DATABASE_URL =
  process.env.DATABASE_URL?.trim() || 'postgres://timeletter:timeletter@localhost:5432/timeletter';

// 密钥优先取环境变量（正式环境由 KMS 注入）；本地未配置时进程内生成一次性开发密钥，不落盘、不硬编码
process.env.LETTER_ENCRYPTION_KEY =
  process.env.LETTER_ENCRYPTION_KEY?.trim() || randomBytes(32).toString('hex');

/**
 * 用例通过 TRUNCATE 清库保证可重复执行，因此本套件只能对「专用测试库」运行。
 * 这里把目标库打到输出里（只留 host/db，不打印账号密码），避免误指向生产或共享库。
 */
function describeTarget(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    return `${url.hostname}:${url.port || '5432'}${url.pathname}`;
  } catch {
    return '<DATABASE_URL 无法解析>';
  }
}

console.warn(
  `[integration] 目标数据库 ${describeTarget(process.env.DATABASE_URL ?? '')}：` +
    '用例会 TRUNCATE 业务表，禁止指向生产/共享库',
);
