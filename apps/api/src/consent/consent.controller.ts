import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { CONSENT_TYPES, type ConsentType } from '@timeletter/shared';
import { AppError } from '../common/app-error';
import { CurrentUser } from '../common/current-identity.decorator';
import { ConsentService } from './consent.service';
import { GrantConsentDto } from './consent.dto';

@Controller('consents')
export class ConsentController {
  constructor(@Inject(ConsentService) private readonly consentService: ConsentService) {}

  @Post()
  grant(@CurrentUser() userId: string, @Body() dto: GrantConsentDto) {
    return this.consentService.grant(userId, dto.type, dto.version, dto.source ?? 'api');
  }

  @Get()
  listMine(@CurrentUser() userId: string) {
    return this.consentService.listByUser(userId);
  }

  /** 撤回同意（US-032）。无有效记录时返回 404，避免静默成功。 */
  @Post(':type/withdraw')
  async withdraw(@CurrentUser() userId: string, @Param('type') type: string) {
    if (!(CONSENT_TYPES as readonly string[]).includes(type)) {
      throw AppError.validation([{ field: 'type', message: '未知的同意类型' }]);
    }
    const record = await this.consentService.withdraw(userId, type as ConsentType);
    if (!record) {
      throw AppError.notFound('没有有效的同意记录可撤回');
    }
    return record;
  }
}
