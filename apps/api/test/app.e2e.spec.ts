import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';

type Agent = ReturnType<typeof request>;

/** 相对于今天的合法投递日期（满足“最早 7 天后”） */
function dateAfterDays(days: number): { year: number; month: number; day: number } {
  const target = new Date();
  target.setDate(target.getDate() + days);
  return { year: target.getFullYear(), month: target.getMonth() + 1, day: target.getDate() };
}

/** 距今最近的非闰年（2月29日顺延用例使用，避免写死年份随时间失效） */
function nextNonLeapYear(): number {
  let year = new Date().getFullYear() + 2;
  while ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) {
    year += 1;
  }
  return year;
}

async function grantConsent(agent: Agent, userId: string, type: string): Promise<void> {
  await agent
    .post('/consents')
    .set('x-user-id', userId)
    .send({ type, version: 'v1.0', source: 'e2e' })
    .expect(201);
}

async function createReadyLetter(
  agent: Agent,
  userId: string,
  text: string,
): Promise<{ letterId: string; recipientId: string }> {
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
    .send(dateAfterDays(10))
    .expect(200);
  await agent
    .put(`/letters/${letterId}/recipient`)
    .set('x-user-id', userId)
    .send({ recipientId: recipient.body.id })
    .expect(200);
  return { letterId, recipientId: recipient.body.id as string };
}

describe('端到端：payment_enabled=false（默认，不收款托管）', () => {
  let app: INestApplication;
  let agent: Agent;

  beforeAll(async () => {
    delete process.env.PAYMENT_ENABLED;
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    agent = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health 暴露支付开关与存储模式', async () => {
    const res = await agent.get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', paymentEnabled: false, storage: 'memory' });
  });

  it('缺少开发期身份请求头时返回 400', async () => {
    const res = await agent.post('/letters').send({}).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.message).toBe('未登录');
    const admin = await agent.get('/admin/moderation/queue').expect(400);
    expect(admin.body.message).toBe('未登录');
  });

  it('u1 完成「建信 → 预览 → 提交托管」链路，订单 0 元直入保管中', async () => {
    const userId = 'u1';
    await grantConsent(agent, userId, 'privacy_policy');
    await grantConsent(agent, userId, 'user_agreement');
    const { letterId } = await createReadyLetter(agent, userId, '你好，未来的你');

    const preview = await agent
      .get(`/letters/${letterId}/preview`)
      .set('x-user-id', userId)
      .expect(200);
    expect(preview.body.maskedEmail).toBe('fut***@example.com');
    expect(preview.body.previewWatermark).toBe(true);
    expect(preview.body.fee).toMatchObject({ payableAmountCents: 0, cta: 'submit_custody' });

    const submitted = await agent
      .post(`/letters/${letterId}/submit`)
      .set('x-user-id', userId)
      .expect(201);
    expect(submitted.body.status).toBe('in_custody');
    expect(submitted.body.custodyCode).toMatch(/^SJ-\d{8}-\d{4}$/);
  });

  it('内容超限与日期超范围返回具体文案', async () => {
    const userId = 'u1';
    const letter = await agent
      .post('/letters')
      .set('x-user-id', userId)
      .send({})
      .expect(201);
    const letterId = letter.body.id as string;
    const tooLong = await agent
      .put(`/letters/${letterId}/content`)
      .set('x-user-id', userId)
      .send({ text: '字'.repeat(2001), images: [] })
      .expect(400);
    expect(tooLong.body.details[0].message).toBe('信件内容已达上限（2000字）');
    const tooSoon = await agent
      .put(`/letters/${letterId}/delivery-date`)
      .set('x-user-id', userId)
      .send({ year: 2020, month: 1, day: 1 })
      .expect(400);
    expect(tooSoon.body.details[0].message).toBe('投递日期最早为 7 天后');
  });

  it('2月29日自动顺延为 3月1日并标记调整', async () => {
    const userId = 'u6';
    const letter = await agent
      .post('/letters')
      .set('x-user-id', userId)
      .send({})
      .expect(201);
    const year = nextNonLeapYear();
    const shifted = await agent
      .put(`/letters/${letter.body.id}/delivery-date`)
      .set('x-user-id', userId)
      .send({ year, month: 2, day: 29 })
      .expect(200);
    expect(shifted.body.deliveryDate).toBe(`${year}-03-01`);
    expect(shifted.body.deliveryDateAdjustedFromFeb29).toBe(true);
  });

  it('u2 审核链路：命中拦截 → 驳回 → 修改重提；管理员可抽检冻结', async () => {
    const userId = 'u2';
    await grantConsent(agent, userId, 'privacy_policy');
    await grantConsent(agent, userId, 'user_agreement');
    const { letterId } = await createReadyLetter(agent, userId, '这封信在讲赌博的故事');

    const pending = await agent
      .post(`/letters/${letterId}/submit`)
      .set('x-user-id', userId)
      .expect(201);
    expect(pending.body.status).toBe('moderation_pending');

    const queue = await agent
      .get('/admin/moderation/queue')
      .set('x-admin-id', 'admin_1')
      .expect(200);
    const item = queue.body.find((entry: { letter: { id: string } }) => entry.letter.id === letterId);
    expect(item.record.hits[0].rule).toBe('赌博');
    // 命中片段改为读取时按已解密正文重算：管理端审核上下文不回退
    expect(item.record.hits[0].snippet).toBe('这封信在讲赌博的故事');

    await agent
      .post(`/admin/moderation/records/${item.record.id}/resolve`)
      .set('x-admin-id', 'admin_1')
      .send({ action: 'reject' })
      .expect(400);
    const rejected = await agent
      .post(`/admin/moderation/records/${item.record.id}/resolve`)
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
  });

  it('u3 撤回第三方告知同意后无法再创建他人收件信息', async () => {
    const userId = 'u3';
    await grantConsent(agent, userId, 'recipient_third_party');
    const created = await agent
      .post('/recipients')
      .set('x-user-id', userId)
      .send({ email: 'other@example.com' })
      .expect(201);
    expect(created.body.id).toBeTruthy();

    const withdrawn = await agent
      .post('/consents/recipient_third_party/withdraw')
      .set('x-user-id', userId)
      .expect(201);
    expect(withdrawn.body.withdrawnAt).not.toBeNull();

    const blocked = await agent
      .post('/recipients')
      .set('x-user-id', userId)
      .send({ email: 'other2@example.com' })
      .expect(400);
    expect(blocked.body.code).toBe('CONSENT_REQUIRED');
    await agent
      .post('/consents/recipient_third_party/withdraw')
      .set('x-user-id', userId)
      .expect(404);
  });

  it('u5 撤回第三方告知后：已绑定草稿提交被拦，重新同意后可提交', async () => {
    const userId = 'u5';
    await grantConsent(agent, userId, 'privacy_policy');
    await grantConsent(agent, userId, 'user_agreement');
    await grantConsent(agent, userId, 'recipient_third_party');
    const recipient = await agent
      .post('/recipients')
      .set('x-user-id', userId)
      .send({ email: 'other@example.com' })
      .expect(201);
    const letter = await agent
      .post('/letters')
      .set('x-user-id', userId)
      .send({})
      .expect(201);
    const letterId = letter.body.id as string;
    await agent
      .put(`/letters/${letterId}/content`)
      .set('x-user-id', userId)
      .send({ text: '你好，未来的你', images: [] })
      .expect(200);
    await agent
      .put(`/letters/${letterId}/delivery-date`)
      .set('x-user-id', userId)
      .send(dateAfterDays(10))
      .expect(200);
    await agent
      .put(`/letters/${letterId}/recipient`)
      .set('x-user-id', userId)
      .send({ recipientId: recipient.body.id })
      .expect(200);

    await agent
      .post('/consents/recipient_third_party/withdraw')
      .set('x-user-id', userId)
      .expect(201);
    const blocked = await agent
      .post(`/letters/${letterId}/submit`)
      .set('x-user-id', userId)
      .expect(400);
    expect(blocked.body.code).toBe('CONSENT_REQUIRED');

    await grantConsent(agent, userId, 'recipient_third_party');
    const submitted = await agent
      .post(`/letters/${letterId}/submit`)
      .set('x-user-id', userId)
      .expect(201);
    expect(submitted.body.status).toBe('in_custody');
  });
});

describe('端到端：payment_enabled=true（仅开关链路，不接真实支付）', () => {
  let app: INestApplication;
  let agent: Agent;

  beforeAll(async () => {
    process.env.PAYMENT_ENABLED = 'true';
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    agent = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
    delete process.env.PAYMENT_ENABLED;
  });

  it('提交后进入待支付，订单金额为定价（990 分）', async () => {
    const userId = 'u4';
    const health = await agent.get('/health').expect(200);
    expect(health.body.paymentEnabled).toBe(true);

    await grantConsent(agent, userId, 'privacy_policy');
    await grantConsent(agent, userId, 'user_agreement');
    const { letterId } = await createReadyLetter(agent, userId, '你好，未来的你');
    const submitted = await agent
      .post(`/letters/${letterId}/submit`)
      .set('x-user-id', userId)
      .expect(201);
    expect(submitted.body.status).toBe('pending_payment');
    expect(submitted.body.custodyCode).toBeNull();
  });
});
