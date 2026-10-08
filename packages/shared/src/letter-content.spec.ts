import { describe, expect, it } from 'vitest';
import { LETTER_LIMITS, countTextLength, validateLetterContent } from './letter-content';

describe('US-002 letter content validation', () => {
  it('accepts content within all limits', () => {
    const result = validateLetterContent({
      text: '亲爱的未来的我：你好。',
      images: [{ id: 'img-1', url: 'https://cdn.example.com/1.jpg', sizeBytes: 1024 }],
      voice: { id: 'v-1', url: 'https://cdn.example.com/1.mp3', durationSeconds: 60 },
    });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('counts text length by unicode code points (emoji counts as 1)', () => {
    expect(countTextLength('😀'.repeat(LETTER_LIMITS.maxTextLength))).toBe(2000);
    const result = validateLetterContent({
      text: '😀'.repeat(LETTER_LIMITS.maxTextLength),
      images: [],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects text longer than 2000 characters with PRD copy', () => {
    const result = validateLetterContent({ text: '字'.repeat(2001), images: [] });
    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual({
      code: 'TEXT_TOO_LONG',
      message: '信件内容已达上限（2000字）',
    });
  });

  it('accepts exactly 2000 characters', () => {
    const result = validateLetterContent({ text: '字'.repeat(2000), images: [] });
    expect(result.ok).toBe(true);
  });

  it('rejects more than 9 images', () => {
    const images = Array.from({ length: 10 }, (_, index) => ({
      id: `img-${index}`,
      url: `https://cdn.example.com/${index}.jpg`,
      sizeBytes: 1024,
    }));
    const result = validateLetterContent({ text: '你好', images });
    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual({
      code: 'TOO_MANY_IMAGES',
      message: '最多插入9张照片',
    });
  });

  it('accepts exactly 9 images of exactly 5MB', () => {
    const images = Array.from({ length: 9 }, (_, index) => ({
      id: `img-${index}`,
      url: `https://cdn.example.com/${index}.jpg`,
      sizeBytes: LETTER_LIMITS.maxImageBytes,
    }));
    expect(validateLetterContent({ text: '你好', images }).ok).toBe(true);
  });

  it('rejects a single image larger than 5MB', () => {
    const result = validateLetterContent({
      text: '你好',
      images: [{ id: 'img-1', url: 'u', sizeBytes: LETTER_LIMITS.maxImageBytes + 1 }],
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual({
      code: 'IMAGE_TOO_LARGE',
      message: '图片超过5MB，请压缩后重试',
    });
  });

  it('rejects voice longer than 60 seconds', () => {
    const result = validateLetterContent({
      text: '你好',
      images: [],
      voice: { id: 'v-1', url: 'u', durationSeconds: LETTER_LIMITS.maxVoiceSeconds + 1 },
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual({
      code: 'VOICE_TOO_LONG',
      message: '单次录音不能超过60秒',
    });
  });

  it('reports multiple violations at once', () => {
    const result = validateLetterContent({
      text: '字'.repeat(2001),
      images: Array.from({ length: 10 }, (_, index) => ({
        id: `img-${index}`,
        url: 'u',
        sizeBytes: LETTER_LIMITS.maxImageBytes + 1,
      })),
    });
    expect(result.violations.map((violation) => violation.code).sort()).toEqual([
      'IMAGE_TOO_LARGE',
      'TEXT_TOO_LONG',
      'TOO_MANY_IMAGES',
    ]);
  });

  it('exposes autosave and draft retention limits per PRD', () => {
    expect(LETTER_LIMITS.autosaveIntervalMs).toBe(5000);
    expect(LETTER_LIMITS.draftRetentionDays).toBe(7);
  });
});
