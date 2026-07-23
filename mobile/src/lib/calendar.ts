// ============================================================
// 日历同步逻辑
// 策略：独立日历 + 全量替换 + 1规则=1事件
// ============================================================

import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Subscription, ReminderRule } from '../types';

const CALENDAR_NAME = 'SubsTracker';
const CALENDAR_ID_KEY = 'substracker_calendar_id';
const CALENDAR_COLOR = '#4F46E5';

/** 请求日历权限 */
export async function requestCalendarPermission(): Promise<boolean> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  return status === 'granted';
}

/** 获取或创建独立日历 */
async function getOrCreateCalendar(): Promise<string | null> {
  // 1. 尝试从缓存读取
  const cachedId = await AsyncStorage.getItem(CALENDAR_ID_KEY);
  if (cachedId) {
    try {
      const cal = await Calendar.getCalendarAsync(cachedId);
      if (cal) return cachedId;
    } catch {
      // 日历被删了，继续创建
    }
  }

  // 2. 查找是否已存在同名日历
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const existing = calendars.find((c) => c.title === CALENDAR_NAME);
  if (existing) {
    await AsyncStorage.setItem(CALENDAR_ID_KEY, existing.id);
    return existing.id;
  }

  // 3. 创建新日历
  const defaultSource =
    Platform.OS === 'ios'
      ? await Calendar.getDefaultCalendarAsync()
      : { isLocalAccount: true, name: CALENDAR_NAME, type: Calendar.SourceType.LOCAL };

  const id = await Calendar.createCalendarAsync({
    title: CALENDAR_NAME,
    color: CALENDAR_COLOR,
    entityType: Calendar.EntityTypes.EVENT,
    source: defaultSource,
    name: CALENDAR_NAME,
    ownerAccount: CALENDAR_NAME,
    accessLevel: Calendar.CalendarAccessLevel.OWNER,
  });

  await AsyncStorage.setItem(CALENDAR_ID_KEY, id);
  return id;
}

/** 根据提醒规则生成事件时间 */
function getRuleEventTime(expiryDate: Date, rule: ReminderRule): { start: Date; end: Date } {
  const expiry = new Date(expiryDate);

  if (rule.type === 'on_expiry_at') {
    // 到期当天指定时间：取第一个小时
    const hours = Array.isArray(rule.hours) && rule.hours.length > 0 ? rule.hours : [9];
    const h = hours[0];
    const start = new Date(expiry);
    start.setHours(h, 0, 0, 0);
    const end = new Date(start);
    end.setMinutes(30);
    return { start, end };
  }

  if (rule.type === 'on_expiry') {
    // 到期当天全天事件
    const start = new Date(expiry);
    start.setHours(9, 0, 0, 0);
    const end = new Date(start);
    end.setHours(10, 0, 0, 0);
    return { start, end };
  }

  // before_expiry: 提前 N 天
  const days = rule.value || 7;
  const start = new Date(expiry);
  start.setDate(start.getDate() - days);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setHours(10, 0, 0, 0);
  return { start, end };
}

/** 生成事件标题 */
function getEventTitle(sub: Subscription, rule: ReminderRule): string {
  if (rule.type === 'before_expiry') {
    return `📅 ${sub.name} 即将到期（提前${rule.value}天）`;
  }
  if (rule.type === 'on_expiry_at') {
    const hours = Array.isArray(rule.hours) ? rule.hours : [];
    const h = hours.length > 0 ? hours[0] : 9;
    return `⏰ ${sub.name} 到期 (${h}:00)`;
  }
  return `⚠️ ${sub.name} 今天到期`;
}

/** 同步日历：删除旧事件 → 按规则重新创建 */
export async function syncCalendar(
  subscriptions: Subscription[],
): Promise<{ eventsCreated: number; errors: number }> {
  const calId = await getOrCreateCalendar();
  if (!calId) throw new Error('无法获取或创建日历');

  // 删除所有旧事件
  const twoYearsMs = 2 * 365 * 24 * 60 * 60 * 1000;
  const now = new Date();
  const past = new Date(now.getTime() - twoYearsMs);
  const future = new Date(now.getTime() + twoYearsMs);

  try {
    const oldEvents = await Calendar.getEventsAsync([calId], past, future);
    await Promise.all(oldEvents.map((e) => Calendar.deleteEventAsync(e.id)));
  } catch {
    // 清空失败不阻塞
  }

  // 重新生成事件
  let eventsCreated = 0;
  let errors = 0;

  for (const sub of subscriptions) {
    if (!sub.isActive) continue;

    const rules = (sub.reminderRules || []).filter((r) => r.isEnabled !== false);
    if (rules.length === 0) continue;

    const expiryDate = new Date(sub.expiryDate);
    if (isNaN(expiryDate.getTime())) continue;

    for (const rule of rules) {
      try {
        const { start, end } = getRuleEventTime(expiryDate, rule);

        await Calendar.createEventAsync(calId, {
          title: getEventTitle(sub, rule),
          startDate: start,
          endDate: end,
          alarms: [{ relativeOffset: 0 }],
          notes: `分类: ${sub.category || '未分类'}\n周期: ${sub.periodValue || 1}${sub.periodUnit === 'month' ? '月' : sub.periodUnit === 'year' ? '年' : '天'}`,
        });

        eventsCreated++;
      } catch (err) {
        console.warn('[Calendar] 创建事件失败:', sub.name, rule.type, err);
        errors++;
      }
    }
  }

  return { eventsCreated, errors };
}
