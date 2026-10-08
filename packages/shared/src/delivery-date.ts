/**
 * US-003：投递日期业务规则（PRD §3.3 业务规则 2-3）。
 * 一期仅电子信笺：范围 今天+7天 至 今天+30年；不可选过去日期和 7 天内日期。
 * 2月29日遇非闰年自动顺延至 3月1日，并在确认页注明。
 */

export const DELIVERY_DATE_RULES = {
  /** 电子信笺最短投递间隔（天） */
  minDaysFromNow: 7,
  /** 最长投递期限（年） */
  maxYearsFromNow: 30,
} as const;

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

export type DeliveryDateErrorCode = 'INVALID_DATE' | 'TOO_SOON' | 'TOO_FAR';

export type DeliveryDateResult =
  | { ok: true; date: string; adjustedFromFeb29: boolean }
  | { ok: false; code: DeliveryDateErrorCode; message: string };

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function toDateOnly(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + days);
  return result;
}

/** 今天+30年；2月29日加 30 年落到非闰年时按 PRD 口径顺延为 3月1日 */
function addYearsWithFeb29Rule(date: Date, years: number): Date {
  const targetYear = date.getFullYear() + years;
  if (date.getMonth() === 1 && date.getDate() === 29 && !isLeapYear(targetYear)) {
    return new Date(targetYear, 2, 1);
  }
  return new Date(targetYear, date.getMonth(), date.getDate());
}

export function resolveDeliveryDate(parts: DateParts, now: Date): DeliveryDateResult {
  if (
    !Number.isInteger(parts.year) ||
    !Number.isInteger(parts.month) ||
    !Number.isInteger(parts.day) ||
    parts.year < 1000 ||
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.day > 31
  ) {
    return { ok: false, code: 'INVALID_DATE', message: '投递日期无效，请重新选择' };
  }

  let year = parts.year;
  let month = parts.month;
  let day = parts.day;
  let adjustedFromFeb29 = false;

  if (month === 2 && day === 29 && !isLeapYear(year)) {
    // 非闰年选择 2月29日 → 顺延至 3月1日
    month = 3;
    day = 1;
    adjustedFromFeb29 = true;
  } else if (day > daysInMonth(year, month)) {
    return { ok: false, code: 'INVALID_DATE', message: '投递日期无效，请重新选择' };
  }

  const date = new Date(year, month - 1, day);
  const dateStr = toDateOnly(date);
  const minStr = toDateOnly(addDays(now, DELIVERY_DATE_RULES.minDaysFromNow));
  const maxStr = toDateOnly(addYearsWithFeb29Rule(now, DELIVERY_DATE_RULES.maxYearsFromNow));

  if (dateStr < minStr) {
    return {
      ok: false,
      code: 'TOO_SOON',
      message: `投递日期最早为 ${DELIVERY_DATE_RULES.minDaysFromNow} 天后`,
    };
  }
  if (dateStr > maxStr) {
    return {
      ok: false,
      code: 'TOO_FAR',
      message: `投递日期最长为 ${DELIVERY_DATE_RULES.maxYearsFromNow} 年内`,
    };
  }

  return { ok: true, date: dateStr, adjustedFromFeb29 };
}
