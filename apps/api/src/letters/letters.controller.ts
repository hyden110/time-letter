import { Body, Controller, Get, Inject, Param, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../common/current-identity.decorator';
import { LettersService } from './letters.service';
import {
  CreateLetterDto,
  SetDeliveryDateDto,
  SetLetterRecipientDto,
  UpdateLetterContentDto,
} from './letters.dto';

@Controller('letters')
export class LettersController {
  constructor(@Inject(LettersService) private readonly lettersService: LettersService) {}

  @Post()
  create(@CurrentUser() userId: string, @Body() dto: CreateLetterDto) {
    return this.lettersService.create(userId, dto);
  }

  @Get()
  listMine(@CurrentUser() userId: string) {
    return this.lettersService.listMine(userId);
  }

  @Get(':id')
  getMine(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.lettersService.getMine(userId, id);
  }

  @Put(':id/content')
  updateContent(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLetterContentDto,
  ) {
    return this.lettersService.updateContent(userId, id, {
      text: dto.text,
      images: dto.images,
      ...(dto.voice ? { voice: dto.voice } : {}),
    });
  }

  @Put(':id/delivery-date')
  setDeliveryDate(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: SetDeliveryDateDto,
  ) {
    return this.lettersService.setDeliveryDate(userId, id, {
      year: dto.year,
      month: dto.month,
      day: dto.day,
    });
  }

  @Put(':id/recipient')
  setRecipient(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: SetLetterRecipientDto,
  ) {
    return this.lettersService.setRecipient(userId, id, dto.recipientId);
  }

  @Get(':id/preview')
  getPreview(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.lettersService.getPreview(userId, id);
  }

  @Post(':id/submit')
  submit(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.lettersService.submit(userId, id);
  }
}
