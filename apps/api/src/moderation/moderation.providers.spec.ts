import { describe, expect, it } from 'vitest';
import {
  CompositeModerationProvider,
  SensitiveWordProvider,
  WechatModerationMockProvider,
} from './moderation.providers';

describe('内容审核通道', () => {
  it('敏感词库命中时只返回词条、分类与位置，不返回正文片段', () => {
    const provider = new SensitiveWordProvider(['赌博']);
    const text = '前言部分：我们来谈谈赌博这种行为的危害';
    const result = provider.check(text);
    expect(result.passed).toBe(false);
    expect(result.hits).toEqual([
      {
        rule: '赌博',
        category: 'sensitive_word',
        index: text.indexOf('赌博'),
      },
    ]);
    // US-009：命中明细会整体落库，序列化后不得出现正文上下文
    expect(JSON.stringify(result.hits)).not.toContain('我们来谈谈');
  });

  it('敏感词库未命中时通过', () => {
    const provider = new SensitiveWordProvider(['赌博']);
    const result = provider.check('只是一封普通的信');
    expect(result.passed).toBe(true);
    expect(result.hits).toEqual([]);
  });

  it('微信内容安全 Mock 恒通过', () => {
    const provider = new WechatModerationMockProvider();
    expect(provider.check('任意内容').passed).toBe(true);
  });

  it('组合通道：任一命中即不通过，并汇总全部通道结果', () => {
    const provider = new CompositeModerationProvider([
      new SensitiveWordProvider(['毒品']),
      new WechatModerationMockProvider(),
    ]);
    const hit = provider.check('这里提到毒品');
    expect(hit.passed).toBe(false);
    expect(hit.hits).toHaveLength(1);

    const pass = provider.check('正常内容');
    expect(pass.passed).toBe(true);
    expect(pass.hits).toEqual([]);
  });
});
