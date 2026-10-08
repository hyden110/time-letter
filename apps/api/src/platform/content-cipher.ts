import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** 密文信封版本；算法或信封结构变更时递增，并保留旧版本解密分支 */
export const ENCRYPTION_VERSION = 1;
export const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

/** AES-256 密钥长度（字节） */
const KEY_BYTES = 32;
/** GCM 推荐 12 字节 IV；每条记录随机生成，禁止复用 */
const IV_BYTES = 12;
/** GCM 认证标签长度（字节） */
const TAG_BYTES = 16;

/**
 * 落库密文信封（US-009）。数据库里只允许出现该结构，禁止出现信件明文。
 * 字段均为 base64，便于 jsonb 存储与人工核查「表里确实是密文」。
 */
export interface EncryptedEnvelope {
  v: number;
  alg: string;
  iv: string;
  tag: string;
  ct: string;
}

/** 密钥/密文相关错误：一律显式抛出，不回退到明文，也不把内容写进 message */
export class EncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionError';
  }
}

/**
 * 解析 LETTER_ENCRYPTION_KEY：接受 64 位十六进制或 base64，二者都必须解码为 32 字节。
 * 仅做格式校验，密钥本身来自环境变量/KMS，禁止硬编码（US-009 密钥分离）。
 */
export function parseEncryptionKey(raw: string): Buffer {
  const trimmed = raw.trim();
  const isHex = /^[0-9a-fA-F]{64}$/.test(trimmed);
  const key = isHex ? Buffer.from(trimmed, 'hex') : Buffer.from(trimmed, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new EncryptionError(
      'INVALID_ENV: LETTER_ENCRYPTION_KEY 必须是 32 字节（64 位十六进制或 base64），' +
        '可用 `openssl rand -hex 32` 生成',
    );
  }
  return key;
}

function isBase64Field(value: unknown, byteLength: number): value is string {
  if (typeof value !== 'string' || value === '') {
    return false;
  }
  return Buffer.from(value, 'base64').length === byteLength;
}

/** 校验从数据库读出的信封结构（jsonb 内容不可信，必须运行时校验后再解密） */
function assertEnvelope(envelope: EncryptedEnvelope): void {
  const invalid = new EncryptionError('ENCRYPTION_FAILED: 密文信封结构非法');
  if (envelope === null || typeof envelope !== 'object') {
    throw invalid;
  }
  if (envelope.v !== ENCRYPTION_VERSION || envelope.alg !== ENCRYPTION_ALGORITHM) {
    throw new EncryptionError('ENCRYPTION_FAILED: 不支持的密文版本或算法');
  }
  if (
    !isBase64Field(envelope.iv, IV_BYTES) ||
    !isBase64Field(envelope.tag, TAG_BYTES) ||
    typeof envelope.ct !== 'string'
  ) {
    throw invalid;
  }
}

/**
 * 信件内容静态加密（US-009）：AES-256-GCM，密钥来自环境变量。
 * 服务层写入前 encryptValue、读取后 decryptValue；仓储与数据库只见密文。
 */
export class ContentCipher {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== KEY_BYTES) {
      throw new EncryptionError('INVALID_ENCRYPTION_KEY: 密钥必须是 32 字节');
    }
    this.key = key;
  }

  /** 由环境变量原始字符串构造（格式非法时启动即失败） */
  static fromKey(raw: string): ContentCipher {
    return new ContentCipher(parseEncryptionKey(raw));
  }

  /** 加密任意可 JSON 序列化的值；每次调用生成新的随机 IV */
  encryptValue(value: unknown): EncryptedEnvelope {
    return this.encryptText(JSON.stringify(value));
  }

  /** 加密原始文本（信封生成/密钥校验的唯一入口） */
  encryptText(plaintext: string): EncryptedEnvelope {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      v: ENCRYPTION_VERSION,
      alg: ENCRYPTION_ALGORITHM,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ct: ciphertext.toString('base64'),
    };
  }

  /** 解密并还原为原值；密钥不匹配或数据被篡改时抛出 EncryptionError */
  decryptValue<T>(envelope: EncryptedEnvelope): T {
    // 先解密（篡改/密钥错误在此显式失败），再解析 JSON，避免掩盖真实失败原因
    const plaintext = this.decryptText(envelope);
    try {
      return JSON.parse(plaintext) as T;
    } catch {
      throw new EncryptionError('ENCRYPTION_FAILED: 解密结果不是合法 JSON');
    }
  }

  /** 解密为原始文本；失败原因不携带密文/明文内容，避免敏感信息进入日志 */
  decryptText(envelope: EncryptedEnvelope): string {
    assertEnvelope(envelope);
    const decipher = createDecipheriv(
      ENCRYPTION_ALGORITHM,
      this.key,
      Buffer.from(envelope.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    try {
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ct, 'base64')),
        decipher.final(),
      ]);
      return plaintext.toString('utf8');
    } catch {
      throw new EncryptionError('ENCRYPTION_FAILED: 密文校验失败（密钥不匹配或数据被篡改）');
    }
  }
}
