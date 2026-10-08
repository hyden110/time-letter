import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ResolveModerationDto {
  @IsIn(['approve', 'reject'])
  action!: 'approve' | 'reject';

  /** 驳回必填（服务层校验，保证中文文案统一） */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class FreezeLetterDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}
