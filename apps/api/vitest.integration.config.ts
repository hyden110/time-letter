import { defineConfig } from 'vitest/config';

/**
 * 真基础设施集成测试（Sprint 1.2-A）。
 * 前置：`docker compose up -d` 起 PostgreSQL，且 DATABASE_URL 指向该实例。
 * 与 `pnpm run verify` 分离：单测/e2e 不连库，本套件连真库。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/integration/**/*.spec.ts'],
    setupFiles: ['test/setup.ts', 'test/integration/setup.ts'],
    // 建表/清表与 HTTP 全链路串行执行，避免用例之间互相踩数据
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
