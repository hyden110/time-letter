import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { TOKENS } from './tokens';
import { loadEnv, type AppEnv } from './config/env';
import { SystemClock } from './platform/clock';
import { ContentCipher } from './platform/content-cipher';
import type { Database } from './platform/database';
import { AppExceptionFilter } from './common/exception.filter';
import { FeatureFlagsService } from './feature-flags/feature-flags.service';
import {
  createConsentRepository,
  createDatabase,
  createLetterRepository,
  createModerationRepository,
  createOrderRepository,
  createRecipientRepository,
} from './persistence/database.factory';
import {
  CompositeModerationProvider,
  SensitiveWordProvider,
  WechatModerationMockProvider,
} from './moderation/moderation.providers';
import { ConsentService } from './consent/consent.service';
import { RecipientsService } from './recipients/recipients.service';
import { ModerationService } from './moderation/moderation.service';
import { LettersService } from './letters/letters.service';
import { LettersController } from './letters/letters.controller';
import { RecipientsController } from './recipients/recipients.controller';
import { ConsentController } from './consent/consent.controller';
import { ModerationController } from './moderation/moderation.controller';
import { HealthController } from './health/health.controller';

@Module({
  controllers: [
    HealthController,
    LettersController,
    RecipientsController,
    ConsentController,
    ModerationController,
  ],
  providers: [
    { provide: APP_PIPE, useValue: new ValidationPipe({ whitelist: true, transform: true }) },
    { provide: APP_FILTER, useClass: AppExceptionFilter },
    { provide: TOKENS.Env, useFactory: () => loadEnv() },
    { provide: TOKENS.Clock, useClass: SystemClock },
    // 存储层：memory 模式为 null，五个仓储据此回落到内存实现（见 database.factory）
    {
      provide: TOKENS.Database,
      useFactory: (env: AppEnv): Database | null => createDatabase(env),
      inject: [TOKENS.Env],
    },
    {
      provide: TOKENS.ContentCipher,
      useFactory: (env: AppEnv) => ContentCipher.fromKey(env.letterEncryptionKey),
      inject: [TOKENS.Env],
    },
    {
      provide: TOKENS.LetterRepository,
      useFactory: (db: Database | null) => createLetterRepository(db),
      inject: [TOKENS.Database],
    },
    {
      provide: TOKENS.RecipientRepository,
      useFactory: (db: Database | null) => createRecipientRepository(db),
      inject: [TOKENS.Database],
    },
    {
      provide: TOKENS.ConsentRepository,
      useFactory: (db: Database | null) => createConsentRepository(db),
      inject: [TOKENS.Database],
    },
    {
      provide: TOKENS.ModerationRepository,
      useFactory: (db: Database | null) => createModerationRepository(db),
      inject: [TOKENS.Database],
    },
    {
      provide: TOKENS.OrderRepository,
      useFactory: (db: Database | null) => createOrderRepository(db),
      inject: [TOKENS.Database],
    },
    {
      provide: TOKENS.ContentModerationProvider,
      useFactory: () =>
        new CompositeModerationProvider([
          new SensitiveWordProvider(),
          new WechatModerationMockProvider(),
        ]),
    },
    FeatureFlagsService,
    ConsentService,
    RecipientsService,
    ModerationService,
    LettersService,
  ],
})
export class AppModule {}
