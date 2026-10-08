import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CONSENT_TYPES, type ConsentType } from '@timeletter/shared';

export class GrantConsentDto {
  @IsIn([...CONSENT_TYPES])
  type!: ConsentType;

  @IsString()
  @MaxLength(32)
  version!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  source?: string;
}
