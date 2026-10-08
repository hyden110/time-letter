/**
 * US-002：信件内容 schema 与上限校验（PRD §3.1 业务规则 3-6）。
 * 该模块同时被用户端（实时校验）与后端（落库前校验）复用，保证口径一致。
 */

export const LETTER_LIMITS = {
  /**
   * 正文上限（按 Unicode 码点计数，emoji 记 1 字）。
   * 照片与语音附件不计入正文。
   */
  maxTextLength: 2000,
  maxImages: 9,
  maxImageBytes: 5 * 1024 * 1024,
  maxVoiceSeconds: 60,
  /** 每 5 秒或编辑区失焦时自动保存 */
  autosaveIntervalMs: 5000,
  /** 未付费草稿保留 7 天 */
  draftRetentionDays: 7,
} as const;

export interface LetterImage {
  id: string;
  url: string;
  sizeBytes: number;
}

export interface LetterVoice {
  id: string;
  url: string;
  durationSeconds: number;
  /** 语音转文字结果（转写失败时省略，原始语音仍保留） */
  transcript?: string;
}

export interface LetterContent {
  text: string;
  images: LetterImage[];
  voice?: LetterVoice;
}

export type ContentViolationCode =
  | 'TEXT_TOO_LONG'
  | 'TOO_MANY_IMAGES'
  | 'IMAGE_TOO_LARGE'
  | 'VOICE_TOO_LONG';

export interface ContentViolation {
  code: ContentViolationCode;
  message: string;
}

export interface ContentValidationResult {
  ok: boolean;
  violations: ContentViolation[];
}

export function countTextLength(text: string): number {
  // 按 Unicode 码点计数：emoji 等增补平面字符记 1 字
  return [...text].length;
}

export function validateLetterContent(content: LetterContent): ContentValidationResult {
  const violations: ContentViolation[] = [];

  if (countTextLength(content.text) > LETTER_LIMITS.maxTextLength) {
    violations.push({
      code: 'TEXT_TOO_LONG',
      message: `信件内容已达上限（${LETTER_LIMITS.maxTextLength}字）`,
    });
  }

  if (content.images.length > LETTER_LIMITS.maxImages) {
    violations.push({
      code: 'TOO_MANY_IMAGES',
      message: `最多插入${LETTER_LIMITS.maxImages}张照片`,
    });
  }

  if (content.images.some((image) => image.sizeBytes > LETTER_LIMITS.maxImageBytes)) {
    violations.push({
      code: 'IMAGE_TOO_LARGE',
      message: `图片超过${LETTER_LIMITS.maxImageBytes / 1024 / 1024}MB，请压缩后重试`,
    });
  }

  if (content.voice && content.voice.durationSeconds > LETTER_LIMITS.maxVoiceSeconds) {
    violations.push({
      code: 'VOICE_TOO_LONG',
      message: `单次录音不能超过${LETTER_LIMITS.maxVoiceSeconds}秒`,
    });
  }

  return { ok: violations.length === 0, violations };
}
