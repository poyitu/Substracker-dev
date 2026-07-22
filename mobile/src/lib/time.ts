// ============================================================
// 时区核心模块（从 Worker 端 src/core/time.js 移植）
// 纯逻辑，无运行时依赖，可直接在 React Native 中使用
// ============================================================

export const MS_PER_HOUR = 1000 * 60 * 60;
export const MS_PER_DAY = MS_PER_HOUR * 24;

export interface TimezoneDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface TimezoneNow {
  utc: Date;
  parts: TimezoneDateParts;
  hourString: string;
  isoLocal: string;
  timezone: string;
}

export function isValidTimezone(timezone: string): boolean {
  if (typeof timezone !== 'string' || timezone.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function safeTimezone(timezone?: string): string {
  if (timezone && isValidTimezone(timezone)) return timezone;
  return 'UTC';
}

export function getTimezoneDateParts(date: Date | string | number, timezone = 'UTC'): TimezoneDateParts {
  const tz = safeTimezone(timezone);
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) {
    return getTimezoneDateParts(new Date(), tz);
  }

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = formatter.formatToParts(d);
    const pick = (type: string) => {
      const part = parts.find((item) => item.type === type);
      return part ? Number(part.value) : 0;
    };
    let hour = pick('hour');
    if (hour === 24) hour = 0;
    return {
      year: pick('year'),
      month: pick('month'),
      day: pick('day'),
      hour,
      minute: pick('minute'),
      second: pick('second'),
    };
  } catch {
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
    };
  }
}

export function getDaysBetween(from: Date | string | number, to: Date | string | number, timezone = 'UTC'): number {
  const tz = safeTimezone(timezone);
  const fromMid = getTimezoneMidnightTimestamp(from, tz);
  const toMid = getTimezoneMidnightTimestamp(to, tz);
  return Math.round((toMid - fromMid) / MS_PER_DAY);
}

export function getTimezoneMidnightTimestamp(date: Date | string | number, timezone = 'UTC'): number {
  const tz = safeTimezone(timezone);
  const { year, month, day } = getTimezoneDateParts(date, tz);
  const t0 = Date.UTC(year, month - 1, day, 0, 0, 0);
  const probeParts = getTimezoneDateParts(new Date(t0), tz);
  const probeAsUtc = Date.UTC(
    probeParts.year,
    probeParts.month - 1,
    probeParts.day,
    probeParts.hour,
    probeParts.minute,
    probeParts.second,
  );
  const offsetMs = probeAsUtc - t0;
  return t0 - offsetMs;
}

export function formatTimeInTimezone(
  time: Date | string | number,
  timezone = 'UTC',
  format: 'date' | 'datetime' | 'full' | 'isoLocal' = 'full',
): string {
  const tz = safeTimezone(timezone);
  const d = time instanceof Date ? time : new Date(time);
  if (Number.isNaN(d.getTime())) return '';

  try {
    if (format === 'date') {
      return d.toLocaleDateString('zh-CN', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    }
    if (format === 'datetime') {
      return d.toLocaleString('zh-CN', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    }
    return d.toLocaleString('zh-CN', { timeZone: tz });
  } catch {
    return d.toISOString();
  }
}


/**
 * 判断订阅是否处于"即将到期"状态，逻辑对齐 Web 管理后台：
 * - 优先取首个启用的 reminder rule
 * - on_expiry / on_expiry_at 视为到期当天
 * - before_expiry / after_expiry 用 unit=day/hour + value 作为窗口
 * - 无 rule 时回退到旧字段 reminderUnit/reminderValue/reminderDays/reminderHours
 */
export function isUpcomingSubscription(
  sub: {
    expiryDate: string;
    isActive: boolean;
    reminderRules?: Array<{
      type: string;
      unit?: string;
      value?: number;
      hours?: number[];
      isEnabled?: boolean;
    }>;
    reminderUnit?: string;
    reminderValue?: number;
    reminderDays?: number;
    reminderHours?: number;
  },
  timezone = 'UTC'
): boolean {
  if (!sub.isActive) return false;

  const now = new Date();
  const expiryDate = new Date(sub.expiryDate);

  const rules = (sub.reminderRules || []).filter((r) => r.isEnabled !== false);

  let unit: string;
  let value: number;

  if (rules.length > 0) {
    const r = rules[0];
    if (r.type === 'on_expiry' || r.type === 'on_expiry_at') {
      unit = 'day';
      value = 0;
    } else {
      unit = r.unit === 'hour' ? 'hour' : 'day';
      value = Number(r.value);
    }
    // 当规则窗口为 0 天（仅"到期当天"提醒），即将到期列表仍按 7 天窗口展示
    if (!isNaN(value) && value === 0) {
      value = 7;
    }
  } else {
    unit = sub.reminderUnit || 'day';
    value = Number(sub.reminderValue ?? sub.reminderDays ?? 7);
    if (unit === 'hour' && (isNaN(value) || value === 0)) {
      value = Number(sub.reminderHours ?? 0);
    }
  }

  if (unit === 'hour') {
    const diffHours = (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60);
    return diffHours >= 0 && diffHours <= value;
  }

  const daysDiff = getDaysBetween(now, expiryDate, timezone);
  return daysDiff >= 0 && daysDiff <= value;
}
