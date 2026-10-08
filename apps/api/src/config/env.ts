import { parseEncryptionKey } from '../platform/content-cipher';

/** 存储模式：memory（单测/内存开发）或 postgres（本地/云上真跑） */
export type StorageMode = 'memory' | 'postgres';

const STORAGE_MODES: readonly StorageMode[] = ['memory', 'postgres'];

export interface AppEnv {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  /** 支付开关；默认 false（一期不接真实支付） */
  paymentEnabled: boolean;
  /** 仓储实现选择：默认 memory，保证单测与 verify 不依赖数据库 */
  storage: StorageMode;
  /** postgres 模式必填；memory 模式为 null（避免误连） */
  databaseUrl: string | null;
  redisUrl: string;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  smsProvider: string;
  moderationWechatMode: string;
  /**
   * 信件内容静态加密密钥（US-009）。仅保存环境变量原值，
   * 启动时已校验格式；禁止硬编码、禁止写入日志。
   */
  letterEncryptionKey: string;
}

function readPort(source: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = source[key];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error(`INVALID_ENV: ${key} 必须是 1-65535 的整数，当前值 "${raw}"`);
  }
  return value;
}

function readDatabaseUrl(source: NodeJS.ProcessEnv): string | null {
  const raw = source.DATABASE_URL;
  return raw === undefined || raw.trim() === '' ? null : raw.trim();
}

function readStorageMode(source: NodeJS.ProcessEnv, databaseUrl: string | null): StorageMode {
  const raw = source.STORAGE_MODE ?? 'memory';
  if (!STORAGE_MODES.includes(raw as StorageMode)) {
    throw new Error(`INVALID_ENV: STORAGE_MODE 只能是 memory 或 postgres，当前值 "${raw}"`);
  }
  const mode = raw as StorageMode;
  if (mode === 'postgres' && databaseUrl === null) {
    throw new Error('INVALID_ENV: STORAGE_MODE=postgres 时必须配置 DATABASE_URL');
  }
  return mode;
}

/** 启动即校验加密密钥存在且格式合法（US-009），避免运行到写库时才失败 */
function readEncryptionKey(source: NodeJS.ProcessEnv): string {
  const raw = source.LETTER_ENCRYPTION_KEY;
  if (raw === undefined || raw.trim() === '') {
    throw new Error(
      'INVALID_ENV: LETTER_ENCRYPTION_KEY 未配置（信件内容静态加密密钥，生成方式见 .env.example）',
    );
  }
  parseEncryptionKey(raw);
  return raw.trim();
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const nodeEnv = (source.NODE_ENV ?? 'development') as AppEnv['nodeEnv'];
  const databaseUrl = readDatabaseUrl(source);
  return {
    nodeEnv,
    port: readPort(source, 'PORT', 3000),
    // 仅显式 'true' 才开启支付；其余（含未设置）一律 false
    paymentEnabled: source.PAYMENT_ENABLED === 'true',
    storage: readStorageMode(source, databaseUrl),
    databaseUrl,
    redisUrl: source.REDIS_URL ?? 'redis://localhost:6379',
    smtpHost: source.SMTP_HOST ?? 'localhost',
    smtpPort: readPort(source, 'SMTP_PORT', 1025),
    mailFrom: source.MAIL_FROM ?? 'noreply@timeletter.local',
    smsProvider: source.SMS_PROVIDER ?? 'mock',
    moderationWechatMode: source.MODERATION_WECHAT_MODE ?? 'mock',
    letterEncryptionKey: readEncryptionKey(source),
  };
}
