import { Inject, Injectable } from '@nestjs/common';
import type { AppEnv } from '../config/env';
import { TOKENS } from '../tokens';

@Injectable()
export class FeatureFlagsService {
  constructor(@Inject(TOKENS.Env) private readonly env: AppEnv) {}

  /**
   * 支付开关（核心约束）：默认 false。
   * false：预览 CTA = 提交托管，订单金额 0，信笺提交后直入「保管中」。
   */
  isPaymentEnabled(): boolean {
    return this.env.paymentEnabled;
  }
}
