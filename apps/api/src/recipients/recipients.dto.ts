import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** 邮箱格式/手机号规则由 packages/shared 统一裁决（BR-1：仅校验 11 位数字） */
export class CreateRecipientDto {
  @IsString()
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  wechatNickname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsBoolean()
  isSelf?: boolean;
}
