import { Inject, Injectable } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import {
  computePreviewFee,
  maskEmail,
  maskPhone,
  resolveDeliveryDate,
  validateLetterContent,
  type DateParts,
  type LetterContent,
  type LetterStatus,
  type LetterType,
} from '@timeletter/shared';
import { AppError } from '../common/app-error';
import { TOKENS } from '../tokens';
import type { Clock } from '../platform/clock';
import type { ContentCipher } from '../platform/content-cipher';
import { UniqueConstraintError } from '../platform/database';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { ConsentService } from '../consent/consent.service';
import { ModerationService } from '../moderation/moderation.service';
import type { RecipientRecord, RecipientRepository } from '../recipients/recipients.repository';
import type { LetterRecord, LetterRepository, StoredLetterRecord } from './letters.repository';
import type { OrderRepository } from '../orders/orders.repository';

/** 允许编辑内容/日期/收件人的状态 */
const EDITABLE_STATUSES: readonly LetterStatus[] = ['draft', 'rejected'];

/** 保管编号随机段空间：SJ-YYYYMMDD-0000 ~ 9999 */
const CUSTODY_CODE_SPACE = 10000;

/**
 * 唯一索引冲突时的最大重试次数。
 * 冲突由数据库唯一索引判定（不做顺序扫描），重试仍冲突即视为当日号段不可用。
 */
const CUSTODY_CODE_MAX_ATTEMPTS = 8;

/** 解析已存的 YYYY-MM-DD 投递日期为日期分量（提交时按期复检用） */
function parseDateOnly(value: string): DateParts {
  const [year, month, day] = value.split('-').map((part) => Number(part));
  return { year, month, day };
}

/** 组装保管编号 SJ-YYYYMMDD-XXXX */
function buildCustodyCode(now: Date, sequence: number): string {
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `SJ-${year}${month}${day}-${`${sequence}`.padStart(4, '0')}`;
}

export interface CreateLetterInput {
  letterType?: LetterType;
  sceneId?: string;
}

export interface DeliveryDateInput {
  year: number;
  month: number;
  day: number;
}

export interface LetterPreview {
  letterId: string;
  content: LetterContent;
  previewWatermark: true;
  deliveryDate: string;
  deliveryDateAdjustedFromFeb29: boolean;
  recipient: { email: string; phone: string | null; wechatNickname: string | null };
  maskedEmail: string;
  maskedPhone: string | null;
  fee: ReturnType<typeof computePreviewFee>;
}

@Injectable()
export class LettersService {
  constructor(
    @Inject(TOKENS.LetterRepository) private readonly letters: LetterRepository,
    @Inject(TOKENS.RecipientRepository) private readonly recipients: RecipientRepository,
    @Inject(TOKENS.OrderRepository) private readonly orders: OrderRepository,
    @Inject(ConsentService) private readonly consentService: ConsentService,
    @Inject(ModerationService) private readonly moderationService: ModerationService,
    @Inject(FeatureFlagsService) private readonly featureFlags: FeatureFlagsService,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    @Inject(TOKENS.ContentCipher) private readonly cipher: ContentCipher,
  ) {}

  /** 新建信笺（一期仅支持电子信笺，实体信笺定价策略已就绪但暂不开放创建） */
  async create(userId: string, input: CreateLetterInput): Promise<LetterRecord> {
    const letterType = input.letterType ?? 'electronic';
    if (letterType !== 'electronic') {
      throw AppError.validation([
        { field: 'letterType', message: '一期仅支持创建电子信笺' },
      ]);
    }
    const now = this.clock.now();
    const stored = await this.letters.create(
      this.toStored({
        id: `letter_${randomUUID()}`,
        userId,
        letterType,
        sceneId: input.sceneId ?? null,
        status: 'draft',
        content: { text: '', images: [] },
        deliveryDate: null,
        deliveryDateAdjustedFromFeb29: false,
        recipientId: null,
        moderationRecordId: null,
        custodyCode: null,
        custodyStartedAt: null,
        reviewReason: null,
        createdAt: now,
        updatedAt: now,
      }),
    );
    return this.toDomain(stored);
  }

  async listMine(userId: string): Promise<LetterRecord[]> {
    const stored = await this.letters.listByUser(userId);
    return stored.map((record) => this.toDomain(record));
  }

  async getMine(userId: string, letterId: string): Promise<LetterRecord> {
    const letter = await this.letters.findById(letterId);
    if (!letter || letter.userId !== userId) {
      throw AppError.notFound('信笺不存在');
    }
    return this.toDomain(letter);
  }

  /** 管理员侧读取（内容审核队列展示信笺内容用） */
  async getByIdInternal(letterId: string): Promise<LetterRecord> {
    const letter = await this.letters.findById(letterId);
    if (!letter) {
      throw AppError.notFound('信笺不存在');
    }
    return this.toDomain(letter);
  }

  /** 保存内容（US-002）。仅草稿/被驳回状态可编辑，保存即重置为草稿待重新提交。 */
  async updateContent(
    userId: string,
    letterId: string,
    content: LetterContent,
  ): Promise<LetterRecord> {
    const letter = await this.getMine(userId, letterId);
    this.assertEditable(letter);
    const validation = validateLetterContent(content);
    if (!validation.ok) {
      throw AppError.validation(
        validation.violations.map((v) => ({ field: v.code, message: v.message })),
      );
    }
    return this.patch(letterId, {
      content: {
        text: content.text,
        images: content.images,
        ...(content.voice ? { voice: content.voice } : {}),
      },
      status: 'draft',
      reviewReason: null,
    });
  }

  /** 设置投递日期（US-003）。2月29日非闰年自动顺延至3月1日。 */
  async setDeliveryDate(
    userId: string,
    letterId: string,
    input: DeliveryDateInput,
  ): Promise<LetterRecord> {
    const letter = await this.getMine(userId, letterId);
    this.assertEditable(letter);
    const resolved = resolveDeliveryDate(input, this.clock.now());
    if (!resolved.ok) {
      throw AppError.validation([{ field: 'deliveryDate', message: resolved.message }]);
    }
    return this.patch(letterId, {
      deliveryDate: resolved.date,
      deliveryDateAdjustedFromFeb29: resolved.adjustedFromFeb29,
    });
  }

  /** 绑定收件人（US-004）。仅可绑定本人创建的收件信息。 */
  async setRecipient(userId: string, letterId: string, recipientId: string): Promise<LetterRecord> {
    const letter = await this.getMine(userId, letterId);
    this.assertEditable(letter);
    const recipient = await this.recipients.findById(recipientId);
    if (!recipient || recipient.userId !== userId) {
      throw AppError.notFound('收件信息不存在');
    }
    return this.patch(letterId, { recipientId: recipient.id });
  }

  /** 预览（US-005）：内容带水印、展示投递日期与脱敏收件人、费用明细（依支付开关）。 */
  async getPreview(userId: string, letterId: string): Promise<LetterPreview> {
    const letter = await this.getMine(userId, letterId);
    const missing = this.collectMissing(letter);
    if (missing.length > 0) {
      throw AppError.precondition(missing.map((m) => ({ field: m.field, message: m.message })));
    }
    const recipient = await this.resolveRecipientOrThrow(letter);
    return {
      letterId: letter.id,
      content: letter.content,
      previewWatermark: true,
      deliveryDate: letter.deliveryDate!,
      deliveryDateAdjustedFromFeb29: letter.deliveryDateAdjustedFromFeb29,
      recipient: {
        email: recipient.email,
        phone: recipient.phone,
        wechatNickname: recipient.wechatNickname,
      },
      maskedEmail: maskEmail(recipient.email),
      maskedPhone: recipient.phone ? maskPhone(recipient.phone) : null,
      fee: computePreviewFee(letter.letterType, this.featureFlags.isPaymentEnabled()),
    };
  }

  /**
   * 提交（US-002/US-024/US-030）。校验内容/日期/收件人与隐私协议同意后进入内容审核；
   * 自动审核通过即按支付开关流转（false：直入保管中；true：待支付，一期不接真实支付回调）。
   * 提交时按当前时钟复检投递日期窗口，并复检第三方收件人的有效同意（撤回后即时生效）。
   */
  async submit(userId: string, letterId: string): Promise<LetterRecord> {
    const letter = await this.getMine(userId, letterId);
    this.assertEditable(letter);
    const missing = this.collectMissing(letter);
    if (missing.length > 0) {
      throw AppError.precondition(missing.map((m) => ({ field: m.field, message: m.message })));
    }
    const deliveryDate = resolveDeliveryDate(parseDateOnly(letter.deliveryDate!), this.clock.now());
    if (!deliveryDate.ok) {
      throw AppError.precondition([
        { field: 'deliveryDate', message: `${deliveryDate.message}，请重新选择投递日期` },
      ]);
    }
    await this.consentService.requireActive(userId, 'privacy_policy', '提交前需同意隐私政策');
    await this.consentService.requireActive(userId, 'user_agreement', '提交前需同意用户协议');
    const recipient = await this.resolveRecipientOrThrow(letter);
    if (!recipient.isSelf) {
      // 撤回第三方信息提供告知后，未提交的信笺必须重新取得有效同意
      await this.consentService.requireActive(
        userId,
        'recipient_third_party',
        '提交前需确认第三方信息提供告知',
      );
    }

    const outcome = await this.moderationService.reviewLetter(letter.id, letter.content);
    const updated = await this.patch(letterId, {
      moderationRecordId: outcome.record.id,
      ...(outcome.autoPassed ? {} : { status: 'moderation_pending' as LetterStatus }),
    });
    if (!outcome.autoPassed) {
      return updated;
    }
    return this.proceedAfterModeration(updated);
  }

  /** 自动审核通过后的流转：支付开关 false → 直入保管中并生成 0 元订单。 */
  private async proceedAfterModeration(letter: LetterRecord): Promise<LetterRecord> {
    const paymentEnabled = this.featureFlags.isPaymentEnabled();
    const amountCents = computePreviewFee(letter.letterType, paymentEnabled).payableAmountCents;
    // 先流转状态再落订单：保管编号写入冲突（含号段用尽）时不会留下无主订单，用户按提示重试仍可走通
    const transitioned = paymentEnabled
      ? await this.patch(letter.id, { status: 'pending_payment' })
      : await this.enterCustody(letter.id, this.clock.now());
    await this.orders.create({
      id: `order_${letter.id}`,
      userId: letter.userId,
      letterId: letter.id,
      amountCents,
      status: paymentEnabled ? 'pending_payment' : 'no_payment_required',
      createdAt: this.clock.now(),
    });
    return transitioned;
  }

  /**
   * 进入保管：生成当日保管编号并写库。
   * 唯一性由数据库唯一索引 letters_custody_code_key 兜底，冲突则换号重试；
   * 连续冲突达到上限说明当日号段不可用，显式返回可重试的业务错误（不做顺序扫描）。
   */
  private async enterCustody(letterId: string, now: Date): Promise<LetterRecord> {
    for (let attempt = 0; attempt < CUSTODY_CODE_MAX_ATTEMPTS; attempt += 1) {
      const candidate = buildCustodyCode(now, randomInt(0, CUSTODY_CODE_SPACE));
      try {
        return await this.patch(letterId, {
          status: 'in_custody',
          custodyCode: candidate,
          custodyStartedAt: now,
        });
      } catch (error) {
        if (!(error instanceof UniqueConstraintError)) {
          throw error;
        }
      }
    }
    throw AppError.forbiddenState('当日保管编号已用尽，请稍后重试');
  }

  /** 人工审核通过（US-024）：继续流转（支付开关分支同上）。 */
  async approveModeration(letterId: string, _reviewerId: string): Promise<LetterRecord> {
    const letter = await this.getByIdInternal(letterId);
    if (letter.status !== 'moderation_pending') {
      throw AppError.forbiddenState('信笺当前状态不可审核通过');
    }
    return this.proceedAfterModeration(letter);
  }

  /** 人工审核驳回（US-024）：记录驳回原因，用户可修改后重新提交，不扣费。 */
  async rejectModeration(
    letterId: string,
    _reviewerId: string,
    reason: string,
  ): Promise<LetterRecord> {
    const letter = await this.getByIdInternal(letterId);
    if (letter.status !== 'moderation_pending') {
      throw AppError.forbiddenState('信笺当前状态不可驳回');
    }
    return this.patch(letterId, { status: 'rejected', reviewReason: reason });
  }

  /** 管理员抽检冻结（US-024）：暂停投递，冻结后不可编辑。 */
  async freezeBySpotCheck(letterId: string, _adminId: string, reason: string): Promise<LetterRecord> {
    const letter = await this.getByIdInternal(letterId);
    if (letter.status !== 'in_custody' && letter.status !== 'pending_payment') {
      throw AppError.forbiddenState('仅保管中/待支付的信笺可冻结');
    }
    return this.patch(letterId, { status: 'frozen', reviewReason: reason });
  }

  private async resolveRecipientOrThrow(letter: LetterRecord): Promise<RecipientRecord> {
    if (!letter.recipientId) {
      throw AppError.precondition([{ field: 'recipient', message: '请先填写收件人信息' }]);
    }
    const recipient = await this.recipients.findById(letter.recipientId);
    if (!recipient) {
      throw AppError.precondition([{ field: 'recipient', message: '收件人信息不存在，请重新填写' }]);
    }
    return recipient;
  }

  private collectMissing(letter: LetterRecord): Array<{ field: string; message: string }> {
    const missing: Array<{ field: string; message: string }> = [];
    if (!letter.content.text.trim()) {
      missing.push({ field: 'content', message: '请先填写信笺正文' });
    }
    if (!letter.deliveryDate) {
      missing.push({ field: 'deliveryDate', message: '请先选择投递日期' });
    }
    if (!letter.recipientId) {
      missing.push({ field: 'recipient', message: '请先填写收件人信息' });
    }
    return missing;
  }

  private assertEditable(letter: LetterRecord): void {
    if (!EDITABLE_STATUSES.includes(letter.status)) {
      throw AppError.forbiddenState('当前状态不可编辑信笺内容');
    }
  }

  private async patch(letterId: string, patch: Partial<LetterRecord>): Promise<LetterRecord> {
    const updated = await this.letters.update(letterId, {
      ...this.toStoredPatch(patch),
      updatedAt: this.clock.now(),
    });
    if (!updated) {
      throw AppError.notFound('信笺不存在');
    }
    return this.toDomain(updated);
  }

  /** 领域记录 → 落库记录：正文加密（US-009，数据库只存密文信封） */
  private toStored(letter: LetterRecord): StoredLetterRecord {
    const { content, ...rest } = letter;
    return { ...rest, content: this.cipher.encryptValue(content) };
  }

  /** 落库记录 → 领域记录：正文解密（读取后才对上层可见） */
  private toDomain(stored: StoredLetterRecord): LetterRecord {
    const { content, ...rest } = stored;
    return { ...rest, content: this.cipher.decryptValue<LetterContent>(content) };
  }

  /** 局部更新：仅在带正文时加密，其余字段原样落库 */
  private toStoredPatch(patch: Partial<LetterRecord>): Partial<StoredLetterRecord> {
    const { content, ...rest } = patch;
    if (content === undefined) {
      return rest;
    }
    return { ...rest, content: this.cipher.encryptValue(content) };
  }
}
