// ============================================================
// 日历同步
// V1: 一键将订阅提醒规则同步到手机系统日历
// ============================================================

import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import * as Calendar from 'expo-calendar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../../src/api/client';
import type { Subscription, ReminderRule } from '../../src/types';

const CALENDAR_ID_KEY = 'synced_calendar_id';

export default function CalendarScreen() {
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [eventCount, setEventCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadSyncState();
    }, []),
  );

  const loadSyncState = async () => {
    try {
      const ts = await AsyncStorage.getItem('last_sync_time');
      if (ts) setLastSync(ts);
      const count = await AsyncStorage.getItem('last_event_count');
      if (count) setEventCount(Number(count));
    } catch {}
  };

  const syncToCalendar = async () => {
    setSyncing(true);
    setError(null);

    if (Platform.OS === 'web') {
      setSyncing(false);
      Alert.alert(
        '暂不支持',
        '日历同步仅在手机 App 中可用，请使用 Expo Go 或打包后的 App 体验此功能。'
      );
      return;
    }

    try {
      // 1. 请求日历权限
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('权限不足', '请允许 SubsTracker 访问日历以创建提醒');
        setSyncing(false);
        return;
      }

      // 2. 获取或创建独立日历
      const calendarId = await getOrCreateCalendar();

      // 3. 获取所有订阅及其规则
      const subs = await apiClient.getSubscriptions();
      const activeSubs = subs.filter((s) => s.isActive);

      // 4. 删除旧事件
      await clearCalendarEvents(calendarId);

      // 5. 为每条规则创建日历事件
      let created = 0;
      for (const sub of activeSubs) {
        let rules: ReminderRule[];
        try {
          rules = await apiClient.getReminderRules(sub.id);
        } catch {
          // 旧订阅可能没有规则，用旧字段推断
          const value = sub.reminderValue ?? sub.reminderDays ?? 7;
          const unit = sub.reminderUnit === 'hour' ? 'hours' : 'days';
          const type = value === 0 ? 'on_expiry' : 'before_expiry';
          rules = [
            { id: 'legacy', type, value, unit, isEnabled: true } as ReminderRule,
          ];
        }

        for (const rule of rules) {
          if (!rule.isEnabled) continue;
          const eventDate = calcEventDate(sub.expiryDate, rule);
          const title = `${sub.name} - ${ruleLabel(rule)}`;
          await Calendar.createEventAsync(calendarId, {
            title,
            startDate: eventDate,
            endDate: new Date(eventDate.getTime() + 30 * 60 * 1000), // 30 分钟
            notes: `订阅「${sub.name}」到期提醒`,
            alarms: [{ relativeOffset: 0 }], // 事件开始时间响铃
          });
          created++;
        }
      }

      // 6. 记录状态
      const now = new Date().toISOString();
      await AsyncStorage.setItem('last_sync_time', now);
      await AsyncStorage.setItem('last_event_count', String(created));
      setLastSync(now);
      setEventCount(created);
      Alert.alert('同步完成', `已在日历中创建 ${created} 个提醒事件`);
    } catch (err: any) {
      const msg = err?.message || '同步失败';
      setError(msg);
      Alert.alert('同步失败', msg);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>日历同步</Text>
        <Text style={styles.headerSubtitle}>将订阅提醒写入手机系统日历</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* 说明卡片 */}
        <View style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={24} color="#6366F1" />
          <View style={styles.infoText}>
            <Text style={styles.infoTitle}>工作原理</Text>
            <Text style={styles.infoDesc}>
              读取所有活跃订阅的提醒规则，在手机日历中创建独立的提醒事件。
              即使 App 未运行，系统日历也会准时提醒你。
            </Text>
          </View>
        </View>

        {/* 同步按钮 */}
        <TouchableOpacity
          style={[styles.syncButton, syncing && styles.syncButtonDisabled]}
          onPress={syncToCalendar}
          disabled={syncing}
          activeOpacity={0.8}
        >
          <Ionicons
            name={syncing ? 'sync' : 'sync-outline'}
            size={22}
            color="#FFFFFF"
          />
          <Text style={styles.syncButtonText}>
            {syncing ? '同步中...' : '立即同步到日历'}
          </Text>
        </TouchableOpacity>

        {/* 同步状态 */}
        {lastSync && (
          <View style={styles.statusCard}>
            <Text style={styles.statusTitle}>上次同步</Text>
            <Text style={styles.statusValue}>
              {new Date(lastSync).toLocaleString('zh-CN')}
            </Text>
            <Text style={styles.statusTitle}>事件数</Text>
            <Text style={styles.statusValue}>{eventCount} 个提醒</Text>
          </View>
        )}

        {error && (
          <View style={styles.errorCard}>
            <Ionicons name="warning-outline" size={18} color="#EF4444" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ---- helpers ----

async function getOrCreateCalendar(): Promise<string> {
  const savedId = await AsyncStorage.getItem(CALENDAR_ID_KEY);
  if (savedId) {
    try {
      const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const exists = cals.some((cal) => cal.id === savedId);
      if (exists) return savedId;
    } catch {}
  }

  const defaultSource =
    Platform.OS === 'ios'
      ? Calendar.EntityTypes.EVENT
      : { isLocalAccount: true, name: 'SubsTracker', type: Calendar.EntityTypes.EVENT };

  const newId = await Calendar.createCalendarAsync({
    title: '订阅管理',
    color: '#4F46E5',
    entityType: Calendar.EntityTypes.EVENT,
    source: defaultSource as any,
    name: 'SubsTracker',
    ownerAccount: 'substracker',
    accessLevel: Calendar.CalendarAccessLevel.OWNER,
  });

  await AsyncStorage.setItem(CALENDAR_ID_KEY, newId);
  return newId;
}

async function clearCalendarEvents(calendarId: string): Promise<void> {
  const now = new Date();
  const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  const oneYearLater = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());

  const events = await Calendar.getEventsAsync(
    [calendarId],
    oneYearAgo,
    oneYearLater,
  );

  await Promise.all(events.map((e) => Calendar.deleteEventAsync(e.id)));
}

function calcEventDate(expiryDateIso: string, rule: ReminderRule): Date {
  const expiry = new Date(expiryDateIso);

  if (rule.type === 'on_expiry_at') {
    const hour = Array.isArray(rule.hours) && rule.hours.length > 0
      ? rule.hours[0]
      : 8;
    expiry.setHours(hour, 0, 0, 0);
    return expiry;
  }

  if (rule.type === 'on_expiry') {
    expiry.setHours(9, 0, 0, 0);
    return expiry;
  }

  // before_expiry
  const msPerUnit = rule.unit === 'hours' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const target = new Date(expiry.getTime() - rule.value * msPerUnit);
  target.setHours(9, 0, 0, 0);
  return target;
}

function ruleLabel(rule: ReminderRule): string {
  switch (rule.type) {
    case 'on_expiry_at': {
      const h = Array.isArray(rule.hours) && rule.hours.length > 0
        ? rule.hours.join(',')
        : '8';
      return `到期日${h}点`;
    }
    case 'on_expiry':
      return '到期当天';
    case 'after_expiry':
      return `到期后每${rule.value}小时`;
    default:
      return `提前${rule.value}${rule.unit === 'hours' ? '小时' : '天'}`;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: { fontSize: 28, fontWeight: '700', color: '#111827' },
  headerSubtitle: { fontSize: 14, color: '#6B7280', marginTop: 2 },
  content: { padding: 16 },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: '#EEF2FF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 20,
  },
  infoText: { flex: 1 },
  infoTitle: { fontSize: 15, fontWeight: '600', color: '#3730A3' },
  infoDesc: { fontSize: 13, color: '#4F46E5', marginTop: 4, lineHeight: 18 },
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4F46E5',
    borderRadius: 12,
    paddingVertical: 16,
    gap: 8,
  },
  syncButtonDisabled: { opacity: 0.6 },
  syncButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  statusCard: {
    marginTop: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
  },
  statusTitle: { fontSize: 13, color: '#6B7280', marginTop: 8 },
  statusValue: { fontSize: 15, color: '#111827', fontWeight: '500', marginTop: 2 },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  errorText: { fontSize: 13, color: '#EF4444', flex: 1 },
});
