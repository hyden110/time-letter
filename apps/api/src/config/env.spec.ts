import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

/** 测试内生成的一次性密钥（非硬编码秘密）：32 字节十六进制 */
const TEST_KEY = randomBytes(32).toString('hex');
const DEV_DATABASE_URL = 'postgres://timeletter:timeletter@localhost:5432/timeletter';

function envWith(overrides: Record<string, string> = {}) {
  return loadEnv({ LETTER_ENCRYPTION_KEY: TEST_KEY, ...overrides } as NodeJS.ProcessEnv);
}

describe('loadEnv', () => {
  it('未配置时使用开发默认值', () => {
    const env = envWith();
    expect(env.nodeEnv).toBe('development');
    expect(env.port).toBe(3000);
    expect(env.paymentEnabled).toBe(false);
    expect(env.smtpHost).toBe('localhost');
    expect(env.smtpPort).toBe(1025);
    expect(env.smsProvider).toBe('mock');
    expect(env.storage).toBe('memory');
    expect(env.databaseUrl).toBeNull();
    expect(env.redisUrl).toContain('localhost:6379');
    expect(env.letterEncryptionKey).toBe(TEST_KEY);
  });

  it('PAYMENT_ENABLED 仅显式 true 开启，其余一律关闭', () => {
    expect(envWith({ PAYMENT_ENABLED: 'true' }).paymentEnabled).toBe(true);
    expect(envWith({ PAYMENT_ENABLED: 'false' }).paymentEnabled).toBe(false);
    expect(envWith({ PAYMENT_ENABLED: '1' }).paymentEnabled).toBe(false);
    expect(envWith({ PAYMENT_ENABLED: 'TRUE' }).paymentEnabled).toBe(false);
  });

  it('端口非法时显式报错', () => {
    expect(() => envWith({ PORT: 'abc' })).toThrowError(/INVALID_ENV/);
    expect(() => envWith({ PORT: '0' })).toThrowError(/"0"/);
    expect(() => envWith({ SMTP_PORT: '65536' })).toThrowError(/INVALID_ENV/);
  });

  it('覆盖端口与 NODE_ENV', () => {
    const env = envWith({ PORT: '8080', NODE_ENV: 'test' });
    expect(env.port).toBe(8080);
    expect(env.nodeEnv).toBe('test');
  });
});

describe('loadEnv 存储模式（Sprint 1.2-A）', () => {
  it('默认内存模式：不连接数据库', () => {
    expect(envWith({ DATABASE_URL: DEV_DATABASE_URL }).storage).toBe('memory');
  });

  it('STORAGE_MODE=postgres 时使用 PG 仓储', () => {
    const env = envWith({ STORAGE_MODE: 'postgres', DATABASE_URL: DEV_DATABASE_URL });
    expect(env.storage).toBe('postgres');
    expect(env.databaseUrl).toBe(DEV_DATABASE_URL);
  });

  it('STORAGE_MODE 非法或缺 DATABASE_URL 时显式报错', () => {
    expect(() => envWith({ STORAGE_MODE: 'redis' })).toThrowError(/STORAGE_MODE 只能是/);
    expect(() => envWith({ STORAGE_MODE: 'postgres' })).toThrowError(/必须配置 DATABASE_URL/);
    expect(() => envWith({ STORAGE_MODE: 'postgres', DATABASE_URL: '  ' })).toThrowError(
      /必须配置 DATABASE_URL/,
    );
  });
});

describe('loadEnv 加密密钥校验（US-009）', () => {
  it('未配置密钥时启动即失败', () => {
    expect(() => loadEnv({} as NodeJS.ProcessEnv)).toThrowError(/LETTER_ENCRYPTION_KEY 未配置/);
    expect(() => loadEnv({ LETTER_ENCRYPTION_KEY: '  ' } as NodeJS.ProcessEnv)).toThrowError(
      /LETTER_ENCRYPTION_KEY 未配置/,
    );
  });

  it('密钥长度不足 32 字节时启动即失败', () => {
    expect(() => envWith({ LETTER_ENCRYPTION_KEY: 'dev-only-not-a-real-key' })).toThrowError(
      /必须是 32 字节/,
    );
  });

  it('接受 64 位十六进制与 base64 两种编码', () => {
    const base64Key = randomBytes(32).toString('base64');
    expect(envWith({ LETTER_ENCRYPTION_KEY: base64Key }).letterEncryptionKey).toBe(base64Key);
    expect(envWith({ LETTER_ENCRYPTION_KEY: TEST_KEY }).letterEncryptionKey).toBe(TEST_KEY);
  });
});
