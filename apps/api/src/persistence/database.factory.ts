import type { AppEnv } from '../config/env';
import type { Database } from '../platform/database';
import { PgDatabase } from '../platform/pg-database';
import type { LetterRepository } from '../letters/letters.repository';
import { InMemoryLetterRepository } from '../letters/letters.repository';
import type { RecipientRepository } from '../recipients/recipients.repository';
import { InMemoryRecipientRepository } from '../recipients/recipients.repository';
import type { ConsentRepository } from '../consent/consent.repository';
import { InMemoryConsentRepository } from '../consent/consent.repository';
import type { ModerationRepository } from '../moderation/moderation.repository';
import { InMemoryModerationRepository } from '../moderation/moderation.repository';
import type { OrderRepository } from '../orders/orders.repository';
import { InMemoryOrderRepository } from '../orders/orders.repository';
import { PgLetterRepository } from './pg/pg-letter.repository';
import { PgRecipientRepository } from './pg/pg-recipient.repository';
import { PgConsentRepository } from './pg/pg-consent.repository';
import { PgModerationRepository } from './pg/pg-moderation.repository';
import { PgOrderRepository } from './pg/pg-order.repository';

/**
 * 仓储实现选择（Sprint 1.2-A）：
 * STORAGE_MODE=memory → 内存实现（单测/e2e/verify 不依赖数据库）；
 * STORAGE_MODE=postgres → PG 适配器（需要 DATABASE_URL，loadEnv 启动时已校验）。
 */

/** memory 模式返回 null，避免误建连接池 */
export function createDatabase(env: AppEnv): Database | null {
  if (env.storage !== 'postgres' || env.databaseUrl === null) {
    return null;
  }
  return new PgDatabase({ connectionString: env.databaseUrl });
}

export function createLetterRepository(db: Database | null): LetterRepository {
  return db === null ? new InMemoryLetterRepository() : new PgLetterRepository(db);
}

export function createRecipientRepository(db: Database | null): RecipientRepository {
  return db === null ? new InMemoryRecipientRepository() : new PgRecipientRepository(db);
}

export function createConsentRepository(db: Database | null): ConsentRepository {
  return db === null ? new InMemoryConsentRepository() : new PgConsentRepository(db);
}

export function createModerationRepository(db: Database | null): ModerationRepository {
  return db === null ? new InMemoryModerationRepository() : new PgModerationRepository(db);
}

export function createOrderRepository(db: Database | null): OrderRepository {
  return db === null ? new InMemoryOrderRepository() : new PgOrderRepository(db);
}
