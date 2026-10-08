import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { LetterType } from '@timeletter/shared';

export class LetterImageDto {
  @IsString()
  @MaxLength(64)
  id!: string;

  @IsString()
  @MaxLength(2048)
  url!: string;

  @IsInt()
  @Min(0)
  sizeBytes!: number;
}

export class LetterVoiceDto {
  @IsString()
  @MaxLength(64)
  id!: string;

  @IsString()
  @MaxLength(2048)
  url!: string;

  @IsInt()
  @Min(0)
  @Max(600)
  durationSeconds!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  transcript?: string;
}

export class CreateLetterDto {
  @IsOptional()
  @IsIn(['electronic', 'entity_standard', 'entity_handmade'])
  letterType?: LetterType;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sceneId?: string;
}

/** 正文长度/图片数量与大小/录音时长由 packages/shared 统一裁决，保证错误文案与 PRD 一致 */
export class UpdateLetterContentDto {
  @IsString()
  text!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LetterImageDto)
  images!: LetterImageDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => LetterVoiceDto)
  voice?: LetterVoiceDto;
}

export class SetDeliveryDateDto {
  @IsInt()
  @Min(1970)
  @Max(2100)
  year!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @IsInt()
  @Min(1)
  @Max(31)
  day!: number;
}

export class SetLetterRecipientDto {
  @IsString()
  @MaxLength(128)
  recipientId!: string;
}
