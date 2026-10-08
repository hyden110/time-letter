/** 依赖注入 token（全部使用 Symbol，配合显式 @Inject，不依赖装饰器元数据） */
export const TOKENS = {
  Env: Symbol('Env'),
  Clock: Symbol('Clock'),
  Database: Symbol('Database'),
  ContentCipher: Symbol('ContentCipher'),
  LetterRepository: Symbol('LetterRepository'),
  RecipientRepository: Symbol('RecipientRepository'),
  ConsentRepository: Symbol('ConsentRepository'),
  ModerationRepository: Symbol('ModerationRepository'),
  OrderRepository: Symbol('OrderRepository'),
  ContentModerationProvider: Symbol('ContentModerationProvider'),
} as const;
