import { defineConfig } from 'vitest/config';

/**
 * 单测 + e2e 配置：一律走内存仓储（test/setup.ts 固定 STORAGE_MODE=memory），
 * 保证 `pnpm run verify` 不依赖任何数据库/中间件。
 * 真基础设施用例见 vitest.integration.config.ts（`pnpm test:integration`）。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.e2e.spec.ts'],
    setupFiles: ['test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/main.ts',
        'src/app.module.ts',
        'src/tokens.ts',
        'src/platform/clock.ts',
        // 需要真实 PostgreSQL，由集成测试套件覆盖
        'src/platform/pg-database.ts',
        'src/persistence/migrate.ts',
        'src/persistence/database.factory.ts',
        'src/persistence/pg/pg-*.repository.ts',
        'src/**/*.dto.ts',
        'src/**/*.spec.ts',
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
