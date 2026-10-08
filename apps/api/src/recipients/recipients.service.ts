import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { validateRecipient } from '@timeletter/shared';
import { AppError } from '../common/app-error';
import { TOKENS } from '../tokens';
import type { Clock } from '../platform/clock';
import { ConsentService } from '../consent/consent.service';
import type { RecipientRecord, RecipientRepository } from './recipients.repository';

export interface CreateRecipientInput {
  email: string;
  wechatNickname?: string;
  phone?: string;
  isSelf?: boolean;
}

@Injectable()
export class RecipientsService {
  constructor(
    @Inject(TOKENS.RecipientRepository) private readonly repository: RecipientRepository,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    @Inject(ConsentService) private readonly consentService: ConsentService,
  ) {}

  /**
   * 创建收件人（US-004）。邮箱必填；手机号选填但填了必须合法。
   * 非本人收件时，需已同意《收件人信息第三方提供告知》（PIPL 告知义务）。
   */
  async create(userId: string, input: CreateRecipientInput): Promise<RecipientRecord> {
    const validation = validateRecipient({
      email: input.email,
      wechatNickname: input.wechatNickname,
      phone: input.phone,
      isSelf: input.isSelf,
    });
    if (!validation.ok) {
      throw AppError.validation(
        validation.errors.map((e) => ({ field: e.field, message: e.message })),
      );
    }

    const isSelf = input.isSelf === true;
    if (!isSelf) {
      await this.consentService.requireActive(
        userId,
        'recipient_third_party',
        '填写他人收件信息前需确认第三方信息提供告知',
      );
    }

    const now = this.clock.now();
    return this.repository.create({
      id: `rcpt_${randomUUID()}`,
      userId,
      email: input.email.trim(),
      wechatNickname: input.wechatNickname?.trim() || null,
      phone: input.phone?.trim().replace(/[\s-]/g, '') || null,
      isSelf,
      createdAt: now,
    });
  }

  async getMine(userId: string, recipientId: string): Promise<RecipientRecord> {
    const found = await this.repository.findById(recipientId);
    if (!found || found.userId !== userId) {
      throw AppError.notFound('收件信息不存在');
    }
    return found;
  }

  async listMine(userId: string): Promise<RecipientRecord[]> {
    return this.repository.listByUser(userId);
  }
}
