import { describe, expect, it } from 'vitest';
import { resolveDeliveryDate, toDateOnly } from './delivery-date';

const NOW = new Date(2026, 8, 30, 10, 0, 0); // 2026-09-30 本地时间

describe('US-003 delivery date rules', () => {
  it('accepts exactly today + 7 days', () => {
    const result = resolveDeliveryDate({ year: 2026, month: 10, day: 7 }, NOW);
    expect(result).toEqual({ ok: true, date: '2026-10-07', adjustedFromFeb29: false });
  });

  it('rejects dates within 7 days', () => {
    const result = resolveDeliveryDate({ year: 2026, month: 10, day: 6 }, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TOO_SOON');
      expect(result.message).toBe('投递日期最早为 7 天后');
    }
  });

  it('rejects past dates', () => {
    const result = resolveDeliveryDate({ year: 2026, month: 9, day: 1 }, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TOO_SOON');
    }
  });

  it('rejects dates beyond today + 30 years', () => {
    const result = resolveDeliveryDate({ year: 2056, month: 10, day: 1 }, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TOO_FAR');
      expect(result.message).toBe('投递日期最长为 30 年内');
    }
  });

  it('accepts exactly today + 30 years', () => {
    const result = resolveDeliveryDate({ year: 2056, month: 9, day: 30 }, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.date).toBe('2056-09-30');
    }
  });

  it('shifts Feb 29 to Mar 1 in a non-leap year and flags it', () => {
    const result = resolveDeliveryDate({ year: 2027, month: 2, day: 29 }, NOW);
    expect(result).toEqual({ ok: true, date: '2027-03-01', adjustedFromFeb29: true });
  });

  it('keeps Feb 29 in a leap year without adjustment', () => {
    const result = resolveDeliveryDate({ year: 2028, month: 2, day: 29 }, NOW);
    expect(result).toEqual({ ok: true, date: '2028-02-29', adjustedFromFeb29: false });
  });

  it('treats Feb 29 shift in the current year as too soon when it lands before the window', () => {
    const result = resolveDeliveryDate({ year: 2026, month: 2, day: 29 }, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TOO_SOON');
    }
  });

  it('rejects invalid calendar dates (Apr 31, month 13, day 0)', () => {
    expect(resolveDeliveryDate({ year: 2026, month: 4, day: 31 }, NOW).ok).toBe(false);
    expect(resolveDeliveryDate({ year: 2026, month: 13, day: 1 }, NOW).ok).toBe(false);
    expect(resolveDeliveryDate({ year: 2026, month: 10, day: 0 }, NOW).ok).toBe(false);
    const result = resolveDeliveryDate({ year: 2026, month: 4, day: 31 }, NOW);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_DATE');
    }
  });

  it('rejects non-integer parts', () => {
    expect(resolveDeliveryDate({ year: 2026.5, month: 10, day: 1 }, NOW).ok).toBe(false);
  });

  it('shifts the 30-year boundary to Mar 1 when today is Feb 29 of a leap year', () => {
    const leapNow = new Date(2028, 1, 29, 9, 0, 0); // 2028-02-29
    // 2028-02-29 + 30 年落到非闰年 2058 → 按「非闰年顺延至 3月1日」口径上界为 2058-03-01
    const accepted = resolveDeliveryDate({ year: 2058, month: 3, day: 1 }, leapNow);
    expect(accepted.ok).toBe(true);
    const alsoAccepted = resolveDeliveryDate({ year: 2058, month: 2, day: 28 }, leapNow);
    expect(alsoAccepted.ok).toBe(true);
    const rejected = resolveDeliveryDate({ year: 2058, month: 3, day: 2 }, leapNow);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.code).toBe('TOO_FAR');
    }
  });

  it('resolves Feb 29 in the boundary year with the same shift rule', () => {
    const leapNow = new Date(2028, 1, 29, 9, 0, 0); // 2028-02-29；2058 非闰年
    const result = resolveDeliveryDate({ year: 2058, month: 2, day: 29 }, leapNow);
    expect(result).toEqual({ ok: true, date: '2058-03-01', adjustedFromFeb29: true });
  });

  it('formats dates as YYYY-MM-DD', () => {
    expect(toDateOnly(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
