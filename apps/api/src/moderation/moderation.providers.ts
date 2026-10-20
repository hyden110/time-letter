import type { ModerationHit } from './moderation.repository';

export interface ModerationProviderResult {
  provider: string;
  passed: boolean;
  hits: ModerationHit[];
}

/** 内容审核通道接口。微信内容安全 API 与自建敏感词库均实现该接口，便于测试替换。 */
export interface ContentModerationProvider {
  readonly name: string;
  check(text: string): ModerationProviderResult;
}

/**
 * 自建敏感词库（开发期内置少量样例词，仅用于链路自测；生产词库由运营配置下发，不入库）。
 */
export const DEV_SAMPLE_SENSITIVE_WORDS: readonly string[] = [
  '赌博',
  '枪支',
  '毒品',
  '代开发票',
  '洗钱',
];

export class SensitiveWordProvider implements ContentModerationProvider {
  readonly name = 'sensitive_word_library';

  constructor(private readonly words: readonly string[] = DEV_SAMPLE_SENSITIVE_WORDS) {}

  check(text: string): ModerationProviderResult {
    const hits: ModerationHit[] = [];
    for (const word of this.words) {
      const index = text.indexOf(word);
      if (index >= 0) {
        // 只记词条与位置：命中明细会整体落库（jsonb），不得携带正文明文（US-009）。
        // 人工审核要看的上下文片段由 moderation.view.ts 在读取时按已解密正文重算。
        hits.push({ rule: word, category: 'sensitive_word', index });
      }
    }
    return { provider: this.name, passed: hits.length === 0, hits };
  }
}

/**
 * 微信内容安全 API（msgSecCheck）开发期 Mock：开发环境无真实 appId/openid 时恒通过。
 * 生产环境替换为真实实现（同一接口，注入真实 access_token 获取逻辑）。
 */
export class WechatModerationMockProvider implements ContentModerationProvider {
  readonly name = 'wechat_msg_sec_check_mock';

  check(_text: string): ModerationProviderResult {
    return { provider: this.name, passed: true, hits: [] };
  }
}

/** 组合多个审核通道：任一通道命中即视为命中，汇总全部通道结果供人工审核参考。 */
export class CompositeModerationProvider implements ContentModerationProvider {
  readonly name = 'composite';

  constructor(private readonly providers: readonly ContentModerationProvider[]) {}

  check(text: string): ModerationProviderResult {
    const results = this.providers.map((p) => p.check(text));
    return {
      provider: this.name,
      passed: results.every((r) => r.passed),
      hits: results.flatMap((r) => r.hits),
    };
  }
}
