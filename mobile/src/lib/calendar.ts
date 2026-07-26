// ============================================================
// 日历同步逻辑 (Modern Expo Calendar API)
// 策略：1 个订阅对应 1 个系统日历事件，多条提醒规则作为 alarms 挂载，彻底解决重复条目问题
// ============================================================

import {
  getCalendars,
  createCalendar,
  requestCalendarPermissions,
  ExpoCalendar,
} from 'expo-calendar';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Subscription, ReminderRule } from '../types';

const CALENDAR_NAME = 'SubsTracker';
const CALENDAR_COLOR = '#4F46E5';
const ALARM_MINUTES_KEY = 'substracker_calendar_alarm_minutes';

/** 请求日历权限并返回诊断信息 */
export async function requestCalendarPermission(): Promise<{ granted: boolean; diagnosis: string }> {
  try {
    const result = await requestCalendarPermissions();
    const diagnosis = `权限状态: ${result.status}${result.expires ? ' / 过期: ' + result.expires : ''}`;
    return { granted: result.status === 'granted', diagnosis };
  } catch (e: any) {
    return { granted: false, diagnosis: `请求权限异常: ${e?.message || String(e)}` };
  }
}

/** 获取或创建 ExpoCalendar 对象实例 */
async function getOrCreateCalendarInstance(): Promise<ExpoCalendar> {
  let calendars: ExpoCalendar[] = [];
  try {
    calendars = await getCalendars();
  } catch (err) {
    console.warn('[Calendar] getCalendars 异常:', err);
  }

  // 1. 优先使用 SubsTracker 同名日历
  const existingAppCal = calendars.find((c) => c.title === CALENDAR_NAME || c.name === CALENDAR_NAME);
  if (existingAppCal) {
    return existingAppCal;
  }

  // 2. 优先使用系统 Primary 日历
  const primaryCal = calendars.find((c) => c.isPrimary);
  if (primaryCal) {
    return primaryCal;
  }

  // 3. 使用任意系统现存可写日历
  const modifiableCal = calendars.find((c) => c.allowsModifications !== false);
  if (modifiableCal) {
    return modifiableCal;
  }

  if (calendars.length > 0) {
    return calendars[0];
  }

  // 4. 创建新日历
  if (Platform.OS === 'ios') {
    return await createCalendar({
      title: CALENDAR_NAME,
      color: CALENDAR_COLOR,
      entityType: 'event',
      name: CALENDAR_NAME,
      ownerAccount: CALENDAR_NAME,
      accessLevel: 'owner',
      timeZone: 'Asia/Shanghai',
      isVisible: true,
      isSynced: true,
    } as any);
  }

  // Android
  return await createCalendar({
    title: CALENDAR_NAME,
    color: CALENDAR_COLOR,
    name: CALENDAR_NAME,
    ownerAccount: 'LOCAL',
    accessLevel: 'owner',
    timeZone: 'Asia/Shanghai',
    isVisible: true,
    isSynced: true,
    source: { isLocalAccount: true, name: 'LOCAL', type: 'LOCAL' },
  } as any);
}

/** 保存闹钟设置 */
export async function saveAlarmMinutes(minutes: number): Promise<void> {
  await AsyncStorage.setItem(ALARM_MINUTES_KEY, String(minutes));
}

/** 读取闹钟设置 */
export async function getAlarmMinutes(): Promise<number> {
  const raw = await AsyncStorage.getItem(ALARM_MINUTES_KEY);
  return raw ? Number(raw) : 0;
}

/** 同步日历：清除旧 SubsTracker 日程 → 按 1 订阅 = 1 事件 写入系统日历 */
export async function syncCalendar(
  subscriptions: Subscription[],
  alarmMinutes: number = 0,
): Promise<{ eventsCreated: number; errors: number; lastError?: string }> {
  const targetCalendar = await getOrCreateCalendarInstance();
  if (!targetCalendar) throw new Error('未找到可用的系统日历，请检查日历权限');

  // 删除所有由 SubsTracker 创建的旧日程（前后 5 年）
  const fiveYearsMs = 5 * 365 * 24 * 60 * 60 * 1000;
  const now = new Date();
  const past = new Date(now.getTime() - fiveYearsMs);
  const future = new Date(now.getTime() + fiveYearsMs);

  try {
    const oldEvents = await targetCalendar.listEvents(past, future);
    const trackerEvents = oldEvents.filter(
      (e: any) =>
        (e.title && (e.title.includes('[SubsTracker]') || e.title.includes('SubsTracker'))) ||
        (e.notes && e.notes.includes('SubsTracker')),
    );

    // 逐个删除旧事件，避免 Promise.all 引起写锁异常
    for (const event of trackerEvents) {
      try {
        await event.delete();
      } catch (err) {
        console.warn('[Calendar] 删除旧事件失败:', event.id, err);
      }
    }
  } catch (err) {
    console.warn('[Calendar] 清理旧提醒失败:', err);
  }

  let eventsCreated = 0;
  let errors = 0;
  let lastErrorMsg = '';

  for (const sub of subscriptions) {
    if (!sub.isActive) continue;
    if (!sub.syncToCalendar) continue;

    // 1. 解构到期日期，精确构造当地时间到期日 09:00
    const dateStr = sub.expiryDate.includes('T') ? sub.expiryDate.split('T')[0] : sub.expiryDate;
    const dateParts = dateStr.split('-').map(Number);
    if (dateParts.length !== 3 || dateParts.some(isNaN)) continue;

    const [year, month, day] = dateParts;
    const eventStartDate = new Date(year, month - 1, day, 9, 0, 0, 0);
    const eventEndDate = new Date(year, month - 1, day, 10, 0, 0, 0);

    // 2. 将 sub.reminderRules 中的所有规则转化为该事件上的 alarms 闹钟
    const rawRules = (sub.reminderRules || []).filter((r) => r.isEnabled !== false);
    const alarms: any[] = [];

    if (rawRules.length > 0) {
      for (const rule of rawRules) {
        if (rule.type === 'before_expiry') {
          const days = rule.value || 1;
          // 提前 N 天提醒 (按每天 1440 分钟计算)
          alarms.push({ relativeOffset: -(days * 24 * 60) });
        } else if (rule.type === 'on_expiry') {
          // 到期当天 09:00 准时提醒
          alarms.push({ relativeOffset: 0 });
        } else if (rule.type === 'on_expiry_at') {
          const hours = Array.isArray(rule.hours) && rule.hours.length > 0 ? rule.hours : [9];
          for (const h of hours) {
            // 计算目标小时与基准 09:00 的分钟差
            const diffMinutes = (h - 9) * 60;
            alarms.push({ relativeOffset: diffMinutes });
          }
        }
      }
    } else {
      // 默认提前 1 天提醒
      alarms.push({ relativeOffset: -(1 * 24 * 60) });
    }

    // 若配置了额外的全局提前响铃偏移，叠加到 alarms 上
    if (alarmMinutes > 0) {
      alarms.forEach((a) => {
        a.relativeOffset -= alarmMinutes;
      });
    }

    const notes = `[SubsTracker 订阅提醒]\n订阅名称: ${sub.name}\n分类: ${sub.category || '未分类'}\n金额: ${sub.amount ? (sub.currency || '￥') + ' ' + sub.amount : '未设置'}\n周期: ${sub.periodValue || 1}${sub.periodUnit === 'month' ? '月' : sub.periodUnit === 'year' ? '年' : '天'}`;

    const details: any = {
      title: `[SubsTracker] 📅 ${sub.name} 到期`,
      startDate: eventStartDate,
      endDate: eventEndDate,
      notes,
      timeZone: 'Asia/Shanghai',
      alarms: alarms.length > 0 ? alarms : undefined,
    };

    try {
      await targetCalendar.createEvent(details);
      eventsCreated++;
    } catch (err: any) {
      lastErrorMsg = err?.message || String(err);
      console.warn('[Calendar] 创建订阅事件失败:', sub.name, err);
      errors++;
    }
  }

  return { eventsCreated, errors, lastError: lastErrorMsg };
}
