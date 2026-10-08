import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ContentCipher,
  EncryptionError,
  ENCRYPTION_ALGORITHM,
  ENCRYPTION_VERSION,
  parseEncryptionKey,
  type EncryptedEnvelope,
} from './content-cipher';

const KEY_HEX = randomBytes(32).toString('hex');
const PLAINTEXT = { text: '你好，未来的你', images: [], voice: undefined };

describe('parseEncryptionKey', () => {
  it('接受 64 位十六进制与 base64 编码的 32 字节密钥', () => {
    expect(parseEncryptionKey(KEY_HEX)).toHaveLength(32);
    const base64Key = randomBytes(32).toString('base64');
    expect(parseEncryptionKey(base64Key)).toHaveLength(32);
    expect(parseEncryptionKey(`  ${KEY_HEX}  `)).toHaveLength(32);
  });

  it('长度不足或非法编码时显式报错', () => {
    expect(() => parseEncryptionKey('dev-only-not-a-real-key')).toThrowError(/必须是 32 字节/);
    expect(() => parseEncryptionKey('')).toThrowError(/必须是 32 字节/);
    expect(() => parseEncryptionKey(randomBytes(16).toString('hex'))).toThrowError(
      /必须是 32 字节/,
    );
  });
});

describe('ContentCipher 构造校验', () => {
  it('密钥不是 32 字节时拒绝构造', () => {
    expect(() => new ContentCipher(randomBytes(16))).toThrowError(/32 字节/);
    expect(() => new ContentCipher(randomBytes(32))).not.toThrowError();
  });
});

describe('ContentCipher 加解密往返（US-009）', () => {
  const cipher = ContentCipher.fromKey(KEY_HEX);

  it('信封结构固定为 aes-256-gcm，且不含明文', () => {
    const envelope = cipher.encryptValue(PLAINTEXT);
    expect(envelope.v).toBe(ENCRYPTION_VERSION);
    expect(envelope.alg).toBe(ENCRYPTION_ALGORITHM);
    expect(Buffer.from(envelope.iv, 'base64')).toHaveLength(12);
    expect(Buffer.from(envelope.tag, 'base64')).toHaveLength(16);
    expect(JSON.stringify(envelope)).not.toContain('未来的你');
  });

  it('解密还原原值；同明文两次加密的 IV 与密文均不同', () => {
    const first = cipher.encryptValue(PLAINTEXT);
    const second = cipher.encryptValue(PLAINTEXT);
    expect(cipher.decryptValue<typeof PLAINTEXT>(first)).toEqual({
      text: '你好，未来的你',
      images: [],
    });
    expect(first.iv).not.toBe(second.iv);
    expect(first.ct).not.toBe(second.ct);
  });

  it('另一把密钥无法解密（密钥分离）', () => {
    const other = ContentCipher.fromKey(randomBytes(32).toString('hex'));
    expect(() => other.decryptValue(cipher.encryptValue(PLAINTEXT))).toThrowError(EncryptionError);
    expect(() => other.decryptValue(cipher.encryptValue(PLAINTEXT))).toThrowError(/密文校验失败/);
  });

  it('密文被篡改时认证失败', () => {
    const envelope = cipher.encryptValue(PLAINTEXT);
    const tampered: EncryptedEnvelope = { ...envelope, ct: cipher.encryptValue('x').ct };
    expect(() => cipher.decryptValue(tampered)).toThrowError(/密文校验失败/);
  });

  it('信封结构非法或版本不支持时显式报错', () => {
    const envelope = cipher.encryptValue(PLAINTEXT);
    expect(() => cipher.decryptValue(null as unknown as EncryptedEnvelope)).toThrowError(
      /信封结构非法/,
    );
    expect(() => cipher.decryptValue({ ...envelope, v: 99 })).toThrowError(/不支持的密文版本/);
    expect(() => cipher.decryptValue({ ...envelope, alg: 'aes-128-cbc' })).toThrowError(
      /不支持的密文版本/,
    );
    expect(() => cipher.decryptValue({ ...envelope, iv: 'short' })).toThrowError(/信封结构非法/);
    expect(() => cipher.decryptValue({ ...envelope, tag: '' })).toThrowError(/信封结构非法/);
    expect(() => cipher.decryptValue({ ...envelope, ct: 1 as unknown as string })).toThrowError(
      /信封结构非法/,
    );
  });

  it('解密结果不是合法 JSON 时报错；原始文本可正常往返', () => {
    expect(cipher.decryptText(cipher.encryptText('你好，未来的你'))).toBe('你好，未来的你');
    expect(() => cipher.decryptValue(cipher.encryptText('这不是 JSON'))).toThrowError(
      /不是合法 JSON/,
    );
  });
});
