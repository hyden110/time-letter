import { Controller, Get, Inject } from '@nestjs/common';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { TOKENS } from '../tokens';
import type { Database } from '../platform/database';

@Controller()
export class HealthController {
  constructor(
    @Inject(FeatureFlagsService) private readonly featureFlags: FeatureFlagsService,
    // 存储模式取自实际注入的仓储连接：memory 模式下 Database 为 null
    @Inject(TOKENS.Database) private readonly database: Database | null,
  ) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      paymentEnabled: this.featureFlags.isPaymentEnabled(),
      storage: this.database === null ? 'memory' : 'postgres',
    };
  }
}
