import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { LettersService, type DeliveryDateInput } from './letters.service';
import { InMemoryLetterRepository } from './letters.repository';
import { InMemoryRecipientRepository } from '../recipients/recipients.repository';
import { InMemoryConsentRepository } from '../consent/consent.repository';
import { InMemoryModerationRepository } from '../moderation/moderation.repository';
import { InMemoryOrderRepository } from '../orders/orders.repository';
import { ConsentService } from '../consent/consent.service';
import { ModerationService } from '../moderation/moderation.service';
import {
  CompositeModerationProvider,
  DEV_SAMPLE_SENSITIVE_WORDS,
  SensitiveWordProvider,
} from '../moderation/moderation.providers';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { ContentCipher } from '../platform/content-cipher';
import { UniqueConstraintError } from '../platform/database';
import type { AppEnv } from '../config/env';
import { AppError } from '../common/app-error';

class FixedClock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current);
  }
  /** 时钟前移（回归：草稿放置过久后提交需被拒） */
  advanceDays(days: number): void {
    this.current = new Date(this.current.getTime() + days * 24 * 60 * 60 * 1000);
  }
}

const NOW = new Date(2026, 8, 30, 10, 0, 0);
const USER = 'u1';

interface Harness {
  service: LettersService;
  consentService: ConsentService;
  clock: FixedClock;
  cipher: ContentCipher;
  recipientRepository: InMemoryRecipientRepository;
  orderRepository: InMemoryOrderRepository;
  letterRepository: InMemoryLetterRepository;
}

function createHarness(
  paymentEnabled = false,
  words: readonly string[] = DEV_SAMPLE_SENSITIVE_WORDS,
): Harness {
  const clock = new FixedClock(NOW);
  // 每个 harness 一把一次性密钥（进程内生成，不落盘、不硬编码）
  const cipher = ContentCipher.fromKey(randomBytes(32).toString('hex'));
  const letterRepository = new InMemoryLetterRepository();
  const recipientRepository = new InMemoryRecipientRepository();
  const consentRepository = new InMemoryConsentRepository();
  const moderationRepository = new InMemoryModerationRepository();
  const orderRepository = new InMemoryOrderRepository();
  const consentService = new ConsentService(consentRepository, clock);
  const moderationService = new ModerationService(
    moderationRepository,
    new CompositeModerationProvider([new SensitiveWordProvider(words)]),
    clock,
  );
  const featureFlags = new FeatureFlagsService({ paymentEnabled } as AppEnv);
  const service = new LettersService(
    letterRepository,
    recipientRepository,
    orderRepository,
    consentService,
    moderationService,
    featureFlags,
    clock,
    cipher,
  );
  return {
    service,
    consentService,
    clock,
    cipher,
    recipientRepository,
    orderRepository,
    letterRepository,
  };
}

async function seedRecipient(
  h: Harness,
  userId = USER,
  email = 'future@example.com',
  isSelf = false,
): Promise<string> {
  const record = await h.recipientRepository.create({
    id: `rcpt_${userId}_1`,
    userId,
    email,
    wechatNickname: null,
    phone: '13800138000',
    isSelf,
    createdAt: NOW,
  });
  return record.id;
}

/** 创建一封内容/日期/收件人均就绪、可提交的信笺 */
async function seedReadyLetter(
  h: Harness,
  userId = USER,
  text = '你好，未来的你',
  delivery: DeliveryDateInput = { year: 2026, month: 10, day: 20 },
  isSelf = false,
): Promise<string> {
  const letter = await h.service.create(userId, {});
  await h.service.updateContent(userId, letter.id, { text, images: [] });
  await h.service.setDeliveryDate(userId, letter.id, delivery);
  await h.service.setRecipient(userId, letter.id, await seedRecipient(h, userId, 'future@example.com', isSelf));
  return letter.id;
}

async function grantSubmitConsents(h: Harness, userId = USER): Promise<void> {
  await h.consentService.grant(userId, 'privacy_policy', 'v1.0', 'test');
  await h.consentService.grant(userId, 'user_agreement', 'v1.0', 'test');
  await h.consentService.grant(userId, 'recipient_third_party', 'v1.0', 'test');
}

async function expectAppError(
  fn: () => Promise<unknown>,
  code: string,
  message: RegExp,
): Promise<void> {
  try {
    await fn();
    throw new Error('应当抛出 AppError');
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    const appError = error as AppError;
    expect(appError.code).toBe(code);
    expect(appError.message).toMatch(message);
  }
}

describe('LettersService 创建与编辑（US-002/US-003）', () => {
  let h: Harness;

  beforeEach(() => {
    h = createHarness();
  });

  it('默认创建电子信笺（draft）；一期拒绝创建实体信笺', async () => {
    const letter = await h.service.create(USER, { sceneId: 'to_future_self' });
    expect(letter.letterType).toBe('electronic');
    expect(letter.status).toBe('draft');
    expect(letter.sceneId).toBe('to_future_self');
    await expectAppError(
      () => h.service.create(USER, { letterType: 'entity_standard' }),
      'VALIDATION_FAILED',
      /一期仅支持创建电子信笺/,
    );
  });

  it('正文超 2000 字被拒，2000 字整可存', async () => {
    const letter = await h.service.create(USER, {});
    await expectAppError(
      () => h.service.updateContent(USER, letter.id, { text: '字'.repeat(2001), images: [] }),
      'VALIDATION_FAILED',
      /信件内容已达上限（2000字）/,
    );
    const saved = await h.service.updateContent(USER, letter.id, {
      text: '字'.repeat(2000),
      images: [],
    });
    expect(saved.content.text).toHaveLength(2000);
  });

  it('2月29日自动顺延至3月1日；超范围日期报对应文案', async () => {
    const letter = await h.service.create(USER, {});
    const shifted = await h.service.setDeliveryDate(USER, letter.id, {
      year: 2027,
      month: 2,
      day: 29,
    });
    expect(shifted.deliveryDate).toBe('2027-03-01');
    expect(shifted.deliveryDateAdjustedFromFeb29).toBe(true);
    await expectAppError(
      () => h.service.setDeliveryDate(USER, letter.id, { year: 2026, month: 10, day: 6 }),
      'VALIDATION_FAILED',
      /投递日期最早为 7 天后/,
    );
    await expectAppError(
      () => h.service.setDeliveryDate(USER, letter.id, { year: 2056, month: 10, day: 1 }),
      'VALIDATION_FAILED',
      /投递日期最长为 30 年内/,
    );
  });

  it('不能绑定他人的收件信息；越权读取返回 404', async () => {
    const otherRecipient = await seedRecipient(h, 'u2');
    const letter = await h.service.create(USER, {});
    await expectAppError(
      () => h.service.setRecipient(USER, letter.id, otherRecipient),
      'NOT_FOUND',
      /收件信息不存在/,
    );
    await expectAppError(() => h.service.getMine('u2', letter.id), 'NOT_FOUND', /信笺不存在/);
    expect(await h.service.listMine('u2')).toHaveLength(0);
  });
});

describe('LettersService 预览与提交（US-005/US-024/US-030）', () => {
  it('预览：字段缺失时返回前置条件明细', async () => {
    const h = createHarness();
    const letter = await h.service.create(USER, {});
    try {
      await h.service.getPreview(USER, letter.id);
      throw new Error('应当抛出前置条件错误');
    } catch (error) {
      const appError = error as AppError;
      expect(appError.code).toBe('PRECONDITION_FAILED');
      expect(appError.details.map((d) => d.field)).toEqual(['content', 'deliveryDate', 'recipient']);
    }
  });

  it('预览：展示脱敏收件人与水印；payment_enabled=false 时应付 0 元、CTA 为提交托管', async () => {
    const h = createHarness(false);
    const letterId = await seedReadyLetter(h);
    const preview = await h.service.getPreview(USER, letterId);
    expect(preview.maskedEmail).toBe('fut***@example.com');
    expect(preview.maskedPhone).toBe('138****8000');
    expect(preview.previewWatermark).toBe(true);
    expect(preview.deliveryDate).toBe('2026-10-20');
    expect(preview.fee.listAmountCents).toBe(990);
    expect(preview.fee.payableAmountCents).toBe(0);
    expect(preview.fee.cta).toBe('submit_custody');
  });

  it('预览：payment_enabled=true 时应付 9.9 元、CTA 为支付', async () => {
    const h = createHarness(true);
    const preview = await h.service.getPreview(USER, await seedReadyLetter(h));
    expect(preview.fee.payableAmountCents).toBe(990);
    expect(preview.fee.cta).toBe('pay');
  });

  it('提交前必须同意隐私政策与用户协议', async () => {
    const h = createHarness();
    const letterId = await seedReadyLetter(h);
    await expectAppError(() => h.service.submit(USER, letterId), 'CONSENT_REQUIRED', /隐私政策/);
    await h.consentService.grant(USER, 'privacy_policy', 'v1.0', 'test');
    await expectAppError(() => h.service.submit(USER, letterId), 'CONSENT_REQUIRED', /用户协议/);
  });

  it('payment_enabled=false：提交后订单 0 元、信笺直入保管中并生成保管编号', async () => {
    const h = createHarness(false);
    const letterId = await seedReadyLetter(h);
    await grantSubmitConsents(h);
    const submitted = await h.service.submit(USER, letterId);
    expect(submitted.status).toBe('in_custody');
    expect(submitted.custodyCode).toMatch(/^SJ-20260930-\d{4}$/);
    expect(submitted.custodyStartedAt?.getTime()).toBe(NOW.getTime());
    const order = await h.orderRepository.findByLetterId(letterId);
    expect(order?.amountCents).toBe(0);
    expect(order?.status).toBe('no_payment_required');
    // 保管编号已随信笺落库（唯一性由数据库唯一索引/内存等价校验兜底）
    expect((await h.letterRepository.findById(letterId))?.custodyCode).toBe(submitted.custodyCode);
    await expectAppError(() => h.service.submit(USER, letterId), 'FORBIDDEN_STATE', /不可编辑/);
  });

  it('payment_enabled=true：提交后订单 990 分、信笺进入待支付（一期不接真实支付）', async () => {
    const h = createHarness(true);
    const letterId = await seedReadyLetter(h);
    await grantSubmitConsents(h);
    const submitted = await h.service.submit(USER, letterId);
    expect(submitted.status).toBe('pending_payment');
    expect(submitted.custodyCode).toBeNull();
    const order = await h.orderRepository.findByLetterId(letterId);
    expect(order?.amountCents).toBe(990);
    expect(order?.status).toBe('pending_payment');
  });

  it('命中敏感词：进入待人工审核且不产生订单', async () => {
    const h = createHarness();
    const letterId = await seedReadyLetter(h, USER, '这封信在讲赌博的故事');
    await grantSubmitConsents(h);
    const submitted = await h.service.submit(USER, letterId);
    expect(submitted.status).toBe('moderation_pending');
    expect(await h.orderRepository.findByLetterId(letterId)).toBeNull();
  });

  it('人工审核通过后继续流转；驳回后可修改并重新提交', async () => {
    const h = createHarness();
    const letterId = await seedReadyLetter(h, USER, '内容含洗钱描述');
    await grantSubmitConsents(h);
    await h.service.submit(USER, letterId);
    const approved = await h.service.approveModeration(letterId, 'admin_1');
    expect(approved.status).toBe('in_custody');

    const secondId = await seedReadyLetter(h, USER, '内容含赌博描述');
    await h.service.submit(USER, secondId);
    const rejected = await h.service.rejectModeration(secondId, 'admin_1', '疑似诈骗话术');
    expect(rejected.status).toBe('rejected');
    expect(rejected.reviewReason).toBe('疑似诈骗话术');

    const edited = await h.service.updateContent(USER, secondId, {
      text: '修改后的干净内容',
      images: [],
    });
    expect(edited.status).toBe('draft');
    expect(edited.reviewReason).toBeNull();
    expect((await h.service.submit(USER, secondId)).status).toBe('in_custody');
  });

  it('抽检冻结：仅保管中/待支付可冻结，冻结后不可编辑', async () => {
    const h = createHarness();
    await expectAppError(
      () => h.service.freezeBySpotCheck('letter_missing', 'admin_1', '抽检'),
      'NOT_FOUND',
      /信笺不存在/,
    );
    const draftId = await seedReadyLetter(h);
    await expectAppError(
      () => h.service.freezeBySpotCheck(draftId, 'admin_1', '抽检'),
      'FORBIDDEN_STATE',
      /仅保管中/,
    );
    await grantSubmitConsents(h);
    const submitted = await h.service.submit(USER, draftId);
    const frozen = await h.service.freezeBySpotCheck(
      submitted.id,
      'admin_1',
      '抽检发现违规内容',
    );
    expect(frozen.status).toBe('frozen');
    await expectAppError(
      () => h.service.updateContent(USER, draftId, { text: '改内容', images: [] }),
      'FORBIDDEN_STATE',
      /不可编辑/,
    );
    await expectAppError(
      () => h.service.approveModeration(draftId, 'admin_1'),
      'FORBIDDEN_STATE',
      /不可审核通过/,
    );
    await expectAppError(
      () => h.service.rejectModeration(draftId, 'admin_1', 'x'),
      'FORBIDDEN_STATE',
      /不可驳回/,
    );
  });
});

describe('LettersService 提交复检回归（代码审查 P1-1/P1-2/P2-3）', () => {
  it('P1-1：草稿放置过久后提交，按当前时钟复检投递日期并引导改期', async () => {
    const h = createHarness(false);
    // 创建时距 NOW 恰好 8 天（合法），随后时钟前移 10 天，最早可投递变为 2026-10-17
    const letterId = await seedReadyLetter(
      h,
      USER,
      '你好，未来的你',
      { year: 2026, month: 10, day: 8 },
      true,
    );
    await grantSubmitConsents(h);
    h.clock.advanceDays(10);
    await expectAppError(
      () => h.service.submit(USER, letterId),
      'PRECONDITION_FAILED',
      /投递日期最早为 7 天后，请重新选择投递日期/,
    );
    await h.service.setDeliveryDate(USER, letterId, { year: 2026, month: 11, day: 1 });
    expect((await h.service.submit(USER, letterId)).status).toBe('in_custody');
  });

  it('P1-2：撤回第三方告知同意后，未提交信笺绑定他人收件人提交被拦；重新同意后可提交', async () => {
    const h = createHarness(false);
    await grantSubmitConsents(h);
    const recipientId = await seedRecipient(h, USER); // 同意有效时创建的他人收件人
    await h.consentService.withdraw(USER, 'recipient_third_party');
    const letter = await h.service.create(USER, {});
    await h.service.updateContent(USER, letter.id, { text: '你好，未来的你', images: [] });
    await h.service.setDeliveryDate(USER, letter.id, { year: 2026, month: 10, day: 20 });
    await h.service.setRecipient(USER, letter.id, recipientId);
    await expectAppError(
      () => h.service.submit(USER, letter.id),
      'CONSENT_REQUIRED',
      /提交前需确认第三方信息提供告知/,
    );
    await h.consentService.grant(USER, 'recipient_third_party', 'v1.0', 'test');
    expect((await h.service.submit(USER, letter.id)).status).toBe('in_custody');
  });

  it('P1-2：本人收件（isSelf）不受第三方告知撤回影响', async () => {
    const h = createHarness(false);
    await grantSubmitConsents(h);
    await h.consentService.withdraw(USER, 'recipient_third_party');
    const letterId = await seedReadyLetter(h, USER, '你好，未来的你', undefined, true);
    expect((await h.service.submit(USER, letterId)).status).toBe('in_custody');
  });

  it('P2-3：保管编号同日冲突时自动重试，直到取到未被占用的编号', async () => {
    const h = createHarness(false);
    const letterId = await seedReadyLetter(h);
    await grantSubmitConsents(h);
    const realUpdate = h.letterRepository.update.bind(h.letterRepository);
    let conflicts = 0;
    const spy = vi
      .spyOn(h.letterRepository, 'update')
      .mockImplementation(async (id, patch) => {
        // 模拟数据库唯一索引 letters_custody_code_key 判定冲突（前两次换号重试）
        if (patch.custodyCode !== undefined && conflicts < 2) {
          conflicts += 1;
          throw new UniqueConstraintError('letters_custody_code_key');
        }
        return realUpdate(id, patch);
      });
    const submitted = await h.service.submit(USER, letterId);
    expect(conflicts).toBe(2);
    expect(submitted.status).toBe('in_custody');
    expect(submitted.custodyCode).toMatch(/^SJ-20260930-\d{4}$/);
    spy.mockRestore();
    const stored = (await h.letterRepository.listByUser(USER)).find(
      (item) => item.custodyCode === submitted.custodyCode,
    );
    expect(stored?.id).toBe(letterId);
  });

  it('P2-3（复审遗留项①）：当日号段连续冲突达上限时报可重试错误，且不写入编号、不留无主订单', async () => {
    const h = createHarness(false);
    const letterId = await seedReadyLetter(h);
    await grantSubmitConsents(h);
    const realUpdate = h.letterRepository.update.bind(h.letterRepository);
    let attempts = 0;
    const spy = vi
      .spyOn(h.letterRepository, 'update')
      .mockImplementation(async (id, patch) => {
        if (patch.custodyCode === undefined) {
          return realUpdate(id, patch);
        }
        attempts += 1;
        throw new UniqueConstraintError('letters_custody_code_key');
      });
    await expectAppError(
      () => h.service.submit(USER, letterId),
      'FORBIDDEN_STATE',
      /当日保管编号已用尽，请稍后重试/,
    );
    expect(attempts).toBe(8);
    spy.mockRestore();
    // 终态：不写保管编号、不进保管中、不产生订单（用户按提示重试仍可走通）
    const stored = await h.letterRepository.findById(letterId);
    expect(stored?.custodyCode).toBeNull();
    expect(stored?.status).toBe('draft');
    expect(await h.orderRepository.findByLetterId(letterId)).toBeNull();
  });
});

describe('LettersService 正文静态加密（US-009）', () => {
  it('仓储只见密文信封，读取时由服务层解密', async () => {
    const h = createHarness(false);
    const letter = await h.service.create(USER, {});
    await h.service.updateContent(USER, letter.id, { text: '你好，未来的你', images: [] });
    const stored = await h.letterRepository.findById(letter.id);
    expect(stored?.content).toMatchObject({ v: 1, alg: 'aes-256-gcm' });
    expect(JSON.stringify(stored?.content)).not.toContain('未来的你');
    expect(h.cipher.decryptValue(stored!.content)).toEqual({ text: '你好，未来的你', images: [] });
    expect((await h.service.getMine(USER, letter.id)).content.text).toBe('你好，未来的你');
    expect((await h.service.listMine(USER))[0].content.text).toBe('你好，未来的你');
  });

  it('提交后的保管中信笺同样是密文落库，审核链路读到的是解密后正文', async () => {
    const h = createHarness(false);
    const letterId = await seedReadyLetter(h);
    await grantSubmitConsents(h);
    await h.service.submit(USER, letterId);
    const stored = await h.letterRepository.findById(letterId);
    expect(typeof stored?.content).toBe('object');
    expect(JSON.stringify(stored?.content)).not.toContain('未来的你');
    expect((await h.service.getByIdInternal(letterId)).content.text).toBe('你好，未来的你');
  });

  it('密钥分离：换一把密钥无法解开既有密文，显式失败而不是返回乱码', async () => {
    const h = createHarness(false);
    const letter = await h.service.create(USER, {});
    await h.service.updateContent(USER, letter.id, { text: '你好，未来的你', images: [] });
    const stored = await h.letterRepository.findById(letter.id);
    const stranger = ContentCipher.fromKey(randomBytes(32).toString('hex'));
    expect(() => stranger.decryptValue(stored!.content)).toThrowError(/密文校验失败/);
  });
});
