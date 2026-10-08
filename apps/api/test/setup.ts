// Nest 运行时依赖 reflect-metadata（所有构造函数参数均显式 @Inject，不依赖 emitDecoratorMetadata）
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';

// 测试进程内生成一次性开发密钥（不落盘、不硬编码）：
// loadEnv 启动即校验 LETTER_ENCRYPTION_KEY，单测/e2e 也需要合法密钥。
process.env.LETTER_ENCRYPTION_KEY ??= randomBytes(32).toString('hex');
// 单测与 e2e 一律走内存仓储，保证 `pnpm run verify` 不依赖数据库。
process.env.STORAGE_MODE ??= 'memory';
