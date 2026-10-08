import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { CurrentUser } from '../common/current-identity.decorator';
import { RecipientsService } from './recipients.service';
import { CreateRecipientDto } from './recipients.dto';

@Controller('recipients')
export class RecipientsController {
  constructor(@Inject(RecipientsService) private readonly recipientsService: RecipientsService) {}

  @Post()
  create(@CurrentUser() userId: string, @Body() dto: CreateRecipientDto) {
    return this.recipientsService.create(userId, dto);
  }

  @Get()
  listMine(@CurrentUser() userId: string) {
    return this.recipientsService.listMine(userId);
  }
}
