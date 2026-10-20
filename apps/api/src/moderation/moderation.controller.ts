import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { CurrentAdmin } from '../common/current-identity.decorator';
import { LettersService } from '../letters/letters.service';
import { ModerationService } from './moderation.service';
import { FreezeLetterDto, ResolveModerationDto } from './moderation.dto';
import { toQueueItem, type ModerationQueueItem } from './moderation.view';

@Controller('admin/moderation')
export class ModerationController {
  constructor(
    @Inject(ModerationService) private readonly moderationService: ModerationService,
    @Inject(LettersService) private readonly lettersService: LettersService,
  ) {}

  /**
   * 人工审核队列：审核记录 + 信笺内容 + 命中原因。
   * 命中片段在此处按解密后的正文重算（数据库里的审核记录只存 {rule, category, index}）。
   */
  @Get('queue')
  async queue(@CurrentAdmin() _adminId: string): Promise<ModerationQueueItem[]> {
    const pending = await this.moderationService.listQueue();
    return Promise.all(
      pending.map(async (record) =>
        toQueueItem(record, await this.lettersService.getByIdInternal(record.letterId)),
      ),
    );
  }

  /** 人工裁决：通过则继续流转；驳回后信笺回到可编辑状态（不扣费）。 */
  @Post('records/:id/resolve')
  async resolve(
    @CurrentAdmin() adminId: string,
    @Param('id') id: string,
    @Body() dto: ResolveModerationDto,
  ) {
    const record = await this.moderationService.resolve(id, dto.action, adminId, dto.reason);
    const letter =
      dto.action === 'approve'
        ? await this.lettersService.approveModeration(record.letterId, adminId)
        : await this.lettersService.rejectModeration(
            record.letterId,
            adminId,
            record.reason ?? '',
          );
    return { record, letter };
  }

  /** 抽检冻结：暂停投递 */
  @Post('letters/:id/freeze')
  freeze(@CurrentAdmin() adminId: string, @Param('id') id: string, @Body() dto: FreezeLetterDto) {
    return this.lettersService.freezeBySpotCheck(id, adminId, dto.reason);
  }
}
