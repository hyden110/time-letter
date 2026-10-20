import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { TOKENS } from '../../src/tokens';
import { ContentCipher, type EncryptedEnvelope } from '../../src/platform/content-cipher';
import { UniqueConstraintError } from '../../src/platform/database';
import { PgDatabase } from '../../src/platform/pg-database';
import { runMigrations } from '../../src/persistence/migrate';
import { PgLetterRepository } from '../../src/persistence/pg/pg-letter.repository';
import { PgRecipientRepository } from '../../src/persistence/pg/pg-recipient.repository';
import { PgConsentRepository } from '../../src/persistence/pg/pg-consent.repository';
import { PgModerationRepository } from '../../src/persistence/pg/pg-moderation.repository';
import { PgOrderRepository } from '../../src/persistence/pg/pg-order.repository';
import type { RecipientRepository } from '../../src/recipients/recipients.repository';
import type { ConsentRepository } from '../../src/consent/consent.repository';
import type { ModerationHit, ModerationRepository } from '../../src/moderation/moderation.repository';
import type { OrderRepository } from '../../src/orders/orders.repository';

type Agent = ReturnType<typeof request>;

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const ENCRYPTION_KEY = process.env.LETTER_ENCRYPTION_KEY ?? '';
const PLAINTEXT = '你好，未来的你：这是一封走真实 PostgreSQL 的信';
/** 命中开发期敏感词样例库（rule=赌博）的正文 */
const FLAGGED_TEXT = '这封信在讲赌博的故事';

let db: PgDatabase;
let app: INestApplication;
let agent: Agent;
let cipher: ContentCipher;

/** 相对于今天的合法投递日期（满足「最早 7 天后」） */
function dateAfterDays(days: number): { year: number; month: number; day: number } {
  const target = new Date();
  target.setDate(target.getDate() + days);
  return { year: target.getFullYear(), month: target.getMonth() + 1, day: target.getDate() };
}

function formatLocalDate(parts: { year: number; month: number; day: number }): string {
  const month = `${parts.month}`.padStart(2, '0');
  const day = `${parts.day}`.padStart(2, '0');
  return `${parts.year}-${month}-${day}`;
}

/** 距今最近的非闰年（2月29日顺延用例，避免写死年份随时间失效） */
function nextNonLeapYear(): number {
  let year = new Date().getFullYear() + 2;
  while ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) {
    year += 1;
  }
  return year;
}

async function grantConsent(userId: string, type: string): Promise<void> {
  await agent
    .post('/consents')
    .set('x-user-id', userId)
    .send({ type, version: 'v1.0', source: 'integration' })
    .expect(201);
}

/** 建信 + 正文 + 投递日期 + 本人收件人，返回可提交的信笺 id */
async function createReadyLetter(userId: string, text: string, days = 10): Promise<string> {
  const recipient = await agent
    .post('/recipients')
    .set('x-user-id', userId)
    .send({ email: 'future@example.com', phone: '13800138000', isSelf: true })
    .expect(201);
  const letter = await agent
    .post('/letters')
    .set('x-user-id', userId)
    .send({ sceneId: 'to_future_self' })
    .expect(201);
  const letterId = letter.body.id as string;
  await agent
    .put(`/letters/${letterId}/content`)
    .set('x-user-id', userId)
    .send({ text, images: [] })
    .expect(200);
  await agent
    .put(`/letters/${letterId}/delivery-date`)
    .set('x-user-id', userId)
    .send(dateAfterDays(days))
    .expect(200);
  await agent
    .put(`/letters/${letterId}/recipient`)
    .set('x-user-id', userId)
    .send({ recipientId: recipient.body.id })
    .expect(200);
  return letterId;
}

/** 提交一封命中敏感词的信笺，返回待人工审核的信笺 id 与审核记录 id */
async function submitFlaggedLetter(
  userId: string,
  text: string,
): Promise<{ letterId: string; recordId: string }> {
  await grantConsent(userId, 'privacy_policy');
  await grantConsent(userId, 'user_agreement');
  const letterId = await createReadyLetter(userId, text);
  const pending = await agent
    .post(`/letters/${letterId}/submit`)
    .set('x-user-id', userId)
    .expect(201);
  expect(pending.body.status).toBe('moderation_pending');
  return { letterId, recordId: pending.body.moderationRecordId as string };
}

/** 绕过服务层直接写一行信笺，用于验证数据库约束本身 */
async function insertRawLetter(id: string, custodyCode: string | null): Promise<void> {
  const now = new Date();
  const envelope = { v: 1, alg: 'aes-256-gcm', iv: 'aa', tag: 'bb', ct: 'cc' };
  await db.query(
    `INSERT INTO letters (
       id, user_id, letter_type, scene_id, status, content, delivery_date,
       delivery_date_adjusted_from_feb29, recipient_id, moderation_record_id,
       custody_code, custody_started_at, review_reason, created_at, updated_at
     ) VALUES ($1, $2, 'electronic', NULL, $3, $4, NULL, false, NULL, NULL, $5, $6, NULL, $7, $7)`,
    [
      id,
      'u_raw',
      custodyCode === null ? 'draft' : 'in_custody',
      JSON.stringify(envelope),
      custodyCode,
      custodyCode === null ? null : now,
      now,
    ],
  );
}

async function readRawContent(letterId: string): Promise<EncryptedEnvelope> {
  const result = await db.query<{ content: EncryptedEnvelope; alg: string }>(
    `SELECT content, content->>'alg' AS alg FROM letters WHERE id = $1`,
    [letterId],
  );
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].alg).toBe('aes-256-gcm');
  return result.rows[0].content;
}

/** 明文扫描覆盖的业务表（表名只来自这里的代码常量，探针值一律走 $1 参数化） */
const BUSINESS_TABLES = ['letters', 'recipients', 'consents', 'moderation_records', 'orders'];

/**
 * 全表明文扫描：逐表把整行转成 ::text 再 LIKE 探针，返回命中行数 >0 的表。
 * 只扫单表单行会漏掉派生数据（例如审核明细里的正文片段），因此这里扫全部 5 张业务表的全部列。
 */
async function scanPlaintext(probe: string): Promise<Record<string, number>> {
  const leaked: Record<string, number> = {};
  for (const table of BUSINESS_TABLES) {
    const result = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${table} WHERE ${table}::text LIKE $1`,
      [`%${probe}%`],
    );
    const matched = result.rows[0]?.n ?? 0;
    if (matched > 0) {
      leaked[table] = matched;
    }
  }
  return leaked;
}

beforeAll(async () => {
  if (DATABASE_URL === '') {
    throw new Error('INVALID_ENV: 集成测试需要 DATABASE_URL（docker compose up -d 后重试）');
  }
  db = new PgDatabase({ connectionString: DATABASE_URL, maxConnections: 3 });
  await db.ping();
  await runMigrations(db);
  cipher = ContentCipher.fromKey(ENCRYPTION_KEY);
  app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  agent = request(app.getHttpServer());
}, 60_000);

beforeEach(async () => {
  // 清库保证用例可重复：本套件只能对专用测试库运行，禁止指向生产/共享库（见 test/integration/setup.ts）
  await db.query('TRUNCATE letters, recipients, consents, moderation_records, orders');
});

afterAll(async () => {
  // beforeAll 失败时 app/db 可能尚未赋值，收尾必须幂等，否则真实错误会被 undefined 报错掩盖
  await app?.close();
  await db?.close();
});

describe('PostgreSQL 迁移与表结构', () => {
  it('迁移建齐业务表与 schema_migrations，重复执行幂等', async () => {
    const tables = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const names = tables.rows.map((row) => row.table_name);
    for (const expected of [
      'letters',
      'recipients',
      'consents',
      'moderation_records',
      'orders',
      'schema_migrations',
    ]) {
      expect(names).toContain(expected);
    }
    const applied = await db.query<{ name: string }>(
      'SELECT name FROM schema_migrations ORDER BY name',
    );
    expect(applied.rows.map((row) => row.name)).toEqual(['001_init.sql']);
    expect(await runMigrations(db)).toEqual([]);
    const stillOne = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM schema_migrations',
    );
    expect(stillOne.rows[0].n).toBe(1);
  });

  it('保管编号由数据库唯一部分索引兜底，重复编号被拒并翻译成 UniqueConstraintError', async () => {
    const index = await db.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'letters' AND indexname = 'letters_custody_code_key'`,
    );
    expect(index.rows).toHaveLength(1);
    expect(index.rows[0].indexdef).toMatch(/UNIQUE INDEX/i);
    expect(index.rows[0].indexdef).toMatch(/WHERE \(custody_code IS NOT NULL\)/);

    await insertRawLetter('letter_a', 'SJ-20260930-0001');
    try {
      await insertRawLetter('letter_b', 'SJ-20260930-0001');
      throw new Error('应当被唯一索引拒绝');
    } catch (error) {
      expect(error).toBeInstanceOf(UniqueConstraintError);
      expect((error as UniqueConstraintError).constraint).toBe('letters_custody_code_key');
    }
  });

  it('部分索引允许多行未分配编号（NULL 不参与唯一约束）', async () => {
    await insertRawLetter('letter_c', null);
    await insertRawLetter('letter_d', null);
    const count = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM letters WHERE custody_code IS NULL',
    );
    expect(count.rows[0].n).toBe(2);
  });

  it('STORAGE_MODE=postgres 时 DI 注入 PG 适配器而不是内存实现', () => {
    expect(app.get(TOKENS.Database)).toBeInstanceOf(PgDatabase);
    expect(app.get(TOKENS.LetterRepository)).toBeInstanceOf(PgLetterRepository);
    expect(app.get(TOKENS.RecipientRepository)).toBeInstanceOf(PgRecipientRepository);
    expect(app.get(TOKENS.ConsentRepository)).toBeInstanceOf(PgConsentRepository);
    expect(app.get(TOKENS.ModerationRepository)).toBeInstanceOf(PgModerationRepository);
    expect(app.get(TOKENS.OrderRepository)).toBeInstanceOf(PgOrderRepository);
  });
});

describe('PostgreSQL 全链路：建信 → 提交 → 保管中', () => {
  it('GET /health 返回 200 并报告 postgres 存储模式', async () => {
    const res = await agent.get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', paymentEnabled: false, storage: 'postgres' });
  });

  it('提交后信笺直入 in_custody 并生成当日保管编号，订单 0 元落库', async () => {
    const userId = 'pg_u1';
    await grantConsent(userId, 'privacy_policy');
    await grantConsent(userId, 'user_agreement');
    const letterId = await createReadyLetter(userId, PLAINTEXT);

    const submitted = await agent
      .post(`/letters/${letterId}/submit`)
      .set('x-user-id', userId)
      .expect(201);
    expect(submitted.body.status).toBe('in_custody');
    expect(submitted.body.custodyCode).toMatch(/^SJ-\d{8}-\d{4}$/);

    const row = await db.query<{ status: string; custody_code: string; custody_started_at: Date }>(
      'SELECT status, custody_code, custody_started_at FROM letters WHERE id = $1',
      [letterId],
    );
    expect(row.rows[0].status).toBe('in_custody');
    expect(row.rows[0].custody_code).toBe(submitted.body.custodyCode);
    expect(row.rows[0].custody_started_at).toBeInstanceOf(Date);

    const order = await db.query<{ amount_cents: number; status: string }>(
      'SELECT amount_cents, status FROM orders WHERE letter_id = $1',
      [letterId],
    );
    expect(order.rows[0]).toEqual({ amount_cents: 0, status: 'no_payment_required' });
  });

  it('两封信笺各自拿到不同的保管编号（唯一索引 + 冲突重试）', async () => {
    const codes: string[] = [];
    for (const userId of ['pg_u2', 'pg_u3']) {
      await grantConsent(userId, 'privacy_policy');
      await grantConsent(userId, 'user_agreement');
      const letterId = await createReadyLetter(userId, PLAINTEXT);
      const submitted = await agent
        .post(`/letters/${letterId}/submit`)
        .set('x-user-id', userId)
        .expect(201);
      expect(submitted.body.status).toBe('in_custody');
      codes.push(submitted.body.custodyCode as string);
    }
    expect(new Set(codes).size).toBe(2);
    const stored = await db.query<{ n: number }>(
      'SELECT count(DISTINCT custody_code)::int AS n FROM letters WHERE custody_code IS NOT NULL',
    );
    expect(stored.rows[0].n).toBe(2);
  });

  it('投递日期经 date 列往返后不偏移（含 2月29日顺延）', async () => {
    const userId = 'pg_u4';
    const expected = formatLocalDate(dateAfterDays(10));
    const letterId = await createReadyLetter(userId, PLAINTEXT, 10);
    const read = await agent.get(`/letters/${letterId}`).set('x-user-id', userId).expect(200);
    expect(read.body.deliveryDate).toBe(expected);
    const raw = await db.query<{ d: string }>(
      `SELECT to_char(delivery_date, 'YYYY-MM-DD') AS d FROM letters WHERE id = $1`,
      [letterId],
    );
    expect(raw.rows[0].d).toBe(expected);

    // 2月29日顺延：草稿仍为可编辑态，改期结果要原样落进 date 列（不随时区偏移一天）
    const year = nextNonLeapYear();
    const adjusted = await agent
      .put(`/letters/${letterId}/delivery-date`)
      .set('x-user-id', userId)
      .send({ year, month: 2, day: 29 })
      .expect(200);
    expect(adjusted.body.deliveryDate).toBe(`${year}-03-01`);
    expect(adjusted.body.deliveryDateAdjustedFromFeb29).toBe(true);
    const rawAdjusted = await db.query<{ d: string; flag: boolean }>(
      `SELECT to_char(delivery_date, 'YYYY-MM-DD') AS d, delivery_date_adjusted_from_feb29 AS flag
       FROM letters WHERE id = $1`,
      [letterId],
    );
    expect(rawAdjusted.rows[0]).toEqual({ d: `${year}-03-01`, flag: true });
  });
});

describe('信件正文静态加密落库（US-009）', () => {
  it('数据库只存 AES-256-GCM 密文信封，明文不出现在行数据中', async () => {
    const userId = 'pg_u5';
    const letterId = await createReadyLetter(userId, PLAINTEXT);
    const envelope = await readRawContent(letterId);
    expect(envelope).toMatchObject({ v: 1, alg: 'aes-256-gcm' });
    expect(typeof envelope.iv).toBe('string');
    expect(typeof envelope.tag).toBe('string');
    expect(envelope.ct.length).toBeGreaterThan(0);
    expect(JSON.stringify(envelope)).not.toContain('未来的你');

    // 整行导出也不含明文（防止列名/日志/备份泄露）
    const dump = await db.query<Record<string, unknown>>(
      'SELECT * FROM letters WHERE id = $1',
      [letterId],
    );
    expect(JSON.stringify(dump.rows[0])).not.toContain('未来的你');
  });

  it('5 张业务表全表扫描：正文片段在任何表的任何列都不出现', async () => {
    // 命中敏感词的信写入 moderation_records，正常信写入 orders：派生表也要有数据才谈得上扫描
    await submitFlaggedLetter('pg_leak_1', FLAGGED_TEXT);
    await grantConsent('pg_leak_2', 'privacy_policy');
    await grantConsent('pg_leak_2', 'user_agreement');
    const cleanLetter = await createReadyLetter('pg_leak_2', PLAINTEXT);
    await agent
      .post(`/letters/${cleanLetter}/submit`)
      .set('x-user-id', 'pg_leak_2')
      .expect(201);

    for (const table of BUSINESS_TABLES) {
      const filled = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
      expect(filled.rows[0].n, `${table} 应当有数据，否则扫描是空转`).toBeGreaterThan(0);
    }
    // 探针带前后文：裸词「赌博」本身就是审核明细的 rule 字段，落库属于预期
    for (const probe of [FLAGGED_TEXT, '在讲赌博的故事', PLAINTEXT, '走真实 PostgreSQL 的信']) {
      expect(await scanPlaintext(probe)).toEqual({});
    }
  });

  it('服务层用同一把密钥可解密回原文，接口返回明文正文', async () => {
    const userId = 'pg_u6';
    const letterId = await createReadyLetter(userId, PLAINTEXT);
    const envelope = await readRawContent(letterId);
    expect(cipher.decryptValue<{ text: string; images: string[] }>(envelope)).toEqual({
      text: PLAINTEXT,
      images: [],
    });
    const read = await agent.get(`/letters/${letterId}`).set('x-user-id', userId).expect(200);
    expect(read.body.content.text).toBe(PLAINTEXT);
    const list = await agent.get('/letters').set('x-user-id', userId).expect(200);
    expect(list.body[0].content.text).toBe(PLAINTEXT);
  });

  it('另一把密钥解不开既有密文（密钥分离，篡改/错钥显式失败）', async () => {
    const userId = 'pg_u7';
    const letterId = await createReadyLetter(userId, PLAINTEXT);
    const envelope = await readRawContent(letterId);
    const stranger = ContentCipher.fromKey(Buffer.alloc(32, 7).toString('hex'));
    expect(() => stranger.decryptValue(envelope)).toThrowError(/密文校验失败/);
  });
});

describe('内容审核与人工裁决（PG 仓储）', () => {
  it('命中敏感词 → 待人工审核：不落订单，审核明细只存位置不存正文', async () => {
    const userId = 'pg_u8';
    const { letterId } = await submitFlaggedLetter(userId, FLAGGED_TEXT);

    expect(await db.query('SELECT 1 FROM orders WHERE letter_id = $1', [letterId])).toMatchObject({
      rowCount: 0,
    });
    const queue = await agent.get('/admin/moderation/queue').set('x-admin-id', 'admin_1').expect(200);
    const item = queue.body.find((entry: { letter: { id: string } }) => entry.letter.id === letterId);
    // 审核上下文在读取时按已解密正文重算，管理端功能不回退
    expect(item.record.hits[0]).toEqual({
      rule: '赌博',
      category: 'sensitive_word',
      index: FLAGGED_TEXT.indexOf('赌博'),
      snippet: FLAGGED_TEXT,
    });
    expect(item.letter.content.text).toBe(FLAGGED_TEXT);

    const row = await db.query<{ decision: string; hits: ModerationHit[] }>(
      'SELECT decision, hits FROM moderation_records WHERE letter_id = $1',
      [letterId],
    );
    expect(row.rows[0].decision).toBe('pending_human_review');
    // 落库形态（US-009）：只有 rule/category/index，没有 snippet，也不含正文上下文
    expect(row.rows[0].hits).toEqual([
      { rule: '赌博', category: 'sensitive_word', index: FLAGGED_TEXT.indexOf('赌博') },
    ]);
    expect(JSON.stringify(row.rows[0].hits)).not.toContain('snippet');
    expect(JSON.stringify(row.rows[0].hits)).not.toContain('在讲');
  });

  it('人工驳回 → 修改重提 → 保管中 → 抽检冻结', async () => {
    const userId = 'pg_u8b';
    const { letterId, recordId } = await submitFlaggedLetter(userId, FLAGGED_TEXT);

    const rejected = await agent
      .post(`/admin/moderation/records/${recordId}/resolve`)
      .set('x-admin-id', 'admin_1')
      .send({ action: 'reject', reason: '疑似诈骗话术' })
      .expect(201);
    expect(rejected.body.letter.status).toBe('rejected');
    expect(rejected.body.letter.reviewReason).toBe('疑似诈骗话术');

    await agent
      .put(`/letters/${letterId}/content`)
      .set('x-user-id', userId)
      .send({ text: '修改后的干净内容', images: [] })
      .expect(200);
    const resubmitted = await agent
      .post(`/letters/${letterId}/submit`)
      .set('x-user-id', userId)
      .expect(201);
    expect(resubmitted.body.status).toBe('in_custody');

    const frozen = await agent
      .post(`/admin/moderation/letters/${letterId}/freeze`)
      .set('x-admin-id', 'admin_1')
      .send({ reason: '抽检发现违规内容' })
      .expect(201);
    expect(frozen.body.status).toBe('frozen');
    const stored = await db.query<{ status: string; review_reason: string }>(
      'SELECT status, review_reason FROM letters WHERE id = $1',
      [letterId],
    );
    expect(stored.rows[0]).toEqual({ status: 'frozen', review_reason: '抽检发现违规内容' });
  });
});

describe('PG 仓储适配往返（recipients / consents / moderation / orders）', () => {
  it('收件人仓储：写入后可按 id 与用户读回', async () => {
    const repository = app.get<RecipientRepository>(TOKENS.RecipientRepository);
    const now = new Date();
    const created = await repository.create({
      id: 'rcpt_pg_1',
      userId: 'pg_u9',
      email: 'future@example.com',
      wechatNickname: '未来的你',
      phone: '13800138000',
      isSelf: false,
      createdAt: now,
    });
    expect(created.email).toBe('future@example.com');
    expect(await repository.findById('rcpt_pg_1')).toMatchObject({
      userId: 'pg_u9',
      wechatNickname: '未来的你',
      phone: '13800138000',
      isSelf: false,
    });
    await repository.create({
      id: 'rcpt_pg_2',
      userId: 'pg_other',
      email: 'other@example.com',
      wechatNickname: null,
      phone: null,
      isSelf: true,
      createdAt: now,
    });
    const mine = await repository.listByUser('pg_u9');
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toBe('rcpt_pg_1');
    expect(await repository.findById('rcpt_missing')).toBeNull();
  });

  it('同意仓储：有效记录唯一，撤回后不可再查到有效同意', async () => {
    const repository = app.get<ConsentRepository>(TOKENS.ConsentRepository);
    const granted = await repository.create({
      id: 'consent_pg_1',
      userId: 'pg_u10',
      type: 'privacy_policy',
      version: 'v1.0',
      grantedAt: new Date(),
      withdrawnAt: null,
      source: 'integration',
    });
    expect(granted.type).toBe('privacy_policy');
    expect(await repository.findActive('pg_u10', 'privacy_policy')).toMatchObject({
      id: 'consent_pg_1',
    });
    // 唯一部分索引 consents_active_key：同一用户同一类型只能有一条未撤回记录
    await expect(
      repository.create({
        id: 'consent_pg_2',
        userId: 'pg_u10',
        type: 'privacy_policy',
        version: 'v2.0',
        grantedAt: new Date(),
        withdrawnAt: null,
        source: 'integration',
      }),
    ).rejects.toBeInstanceOf(UniqueConstraintError);

    const withdrawn = await repository.withdraw('consent_pg_1', new Date());
    expect(withdrawn?.withdrawnAt).toBeInstanceOf(Date);
    expect(await repository.findActive('pg_u10', 'privacy_policy')).toBeNull();
    expect(await repository.withdraw('consent_pg_1', new Date())).toBeNull();
    expect(await repository.listByUser('pg_u10')).toHaveLength(1);
  });

  it('审核仓储：jsonb 明细往返，人工裁决通过白名单动态更新', async () => {
    const repository = app.get<ModerationRepository>(TOKENS.ModerationRepository);
    await repository.create({
      id: 'mod_pg_1',
      letterId: 'letter_pg_1',
      decision: 'pending_human_review',
      hits: [{ rule: '赌博', category: 'sensitive_word', index: 5 }],
      providerResults: [{ provider: 'sensitive_word', passed: false }],
      reviewerId: null,
      reason: null,
      createdAt: new Date(),
      resolvedAt: null,
    });
    expect(await repository.findByLetterId('letter_pg_1')).toMatchObject({
      decision: 'pending_human_review',
      hits: [{ rule: '赌博', category: 'sensitive_word', index: 5 }],
      providerResults: [{ provider: 'sensitive_word', passed: false }],
    });
    expect(await repository.listByDecision('pending_human_review')).toHaveLength(1);

    const resolved = await repository.update('mod_pg_1', {
      decision: 'rejected',
      reviewerId: 'admin_1',
      reason: '疑似诈骗话术',
      resolvedAt: new Date(),
    });
    expect(resolved).toMatchObject({ decision: 'rejected', reason: '疑似诈骗话术' });
    expect(await repository.findById('mod_pg_1')).toMatchObject({ reviewerId: 'admin_1' });
    expect(await repository.listByDecision('pending_human_review')).toHaveLength(0);
    expect(await repository.update('mod_missing', { decision: 'approved' })).toBeNull();
  });

  it('订单仓储：一封信笺一条订单，重复下单被唯一索引拒绝', async () => {
    const repository = app.get<OrderRepository>(TOKENS.OrderRepository);
    const created = await repository.create({
      id: 'order_pg_1',
      userId: 'pg_u11',
      letterId: 'letter_pg_2',
      amountCents: 0,
      status: 'no_payment_required',
      createdAt: new Date(),
    });
    expect(created.amountCents).toBe(0);
    expect(await repository.findByLetterId('letter_pg_2')).toMatchObject({ id: 'order_pg_1' });
    expect(await repository.findById('order_pg_1')).toMatchObject({ status: 'no_payment_required' });
    await repository.create({
      id: 'order_pg_2',
      userId: 'pg_other',
      letterId: 'letter_pg_3',
      amountCents: 990,
      status: 'pending_payment',
      createdAt: new Date(),
    });
    expect(await repository.listByUser('pg_u11')).toHaveLength(1);
    await expect(
      repository.create({
        id: 'order_pg_3',
        userId: 'pg_u11',
        letterId: 'letter_pg_2',
        amountCents: 0,
        status: 'no_payment_required',
        createdAt: new Date(),
      }),
    ).rejects.toBeInstanceOf(UniqueConstraintError);
    expect(await repository.findByLetterId('letter_missing')).toBeNull();
  });
});
