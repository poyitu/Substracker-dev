// ============================================================
// 日历同步
// ============================================================

import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Platform, TextInput } from 'react-native';
import { useState, useCallback, useEffect } from 'react';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../../src/api/client';
import { useAuth } from '../../src/stores/auth';
import { requestCalendarPermission, syncCalendar, saveAlarmMinutes, getAlarmMinutes } from '../../src/lib/calendar';
import type { Subscription } from '../../src/types';

export default function CalendarScreen() {
  const { isLoggedIn } = useAuth();
  const [loading, setLoading] = useState(false);
  const [alarmMinutes, setAlarmMinutes] = useState(0);
  const [lastSync, setLastSync] = useState<{ time: Date; events: number; errors: number } | null>(null);

  useEffect(() => {
    getAlarmMinutes().then(setAlarmMinutes);
  }, []);

  const updateAlarm = async (v: string) => {
    const n = v === '' ? 0 : parseInt(v, 10);
    if (isNaN(n) || n < 0) return;
    setAlarmMinutes(n);
    await saveAlarmMinutes(n);
  };

  const loadAndSync = useCallback(async () => {
    if (!isLoggedIn) return;
    setLoading(true);
    try {
      const permitted = await requestCalendarPermission();
      if (!permitted) {
        Alert.alert('权限不足', '需要日历权限才能同步提醒');
        return;
      }

      const subs: Subscription[] = await apiClient.getSubscriptions();
      const withCalendar = subs.filter((s) => s.syncToCalendar);
      if (withCalendar.length === 0) {
        Alert.alert('提示', '没有开启日历同步的订阅');
        return;
      }

      const result = await syncCalendar(subs, alarmMinutes);
      setLastSync({ time: new Date(), events: result.eventsCreated, errors: result.errors });

      const msg =
        result.errors > 0
          ? `已创建 ${result.eventsCreated} 个事件，${result.errors} 个失败`
          : `已同步 ${result.eventsCreated} 个日历事件`;
      Alert.alert('同步完成', msg);
    } catch (err: any) {
      Alert.alert('同步失败', err.message || '请重试');
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn, alarmMinutes]);

  useFocusEffect(
    useCallback(() => {}, []),
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>日历同步</Text>
      </View>

      <View style={styles.content}>
        {lastSync ? (
          <View style={styles.statusCard}>
            <Ionicons name="checkmark-circle" size={48} color="#10B981" />
            <Text style={styles.statusTitle}>上次同步</Text>
            <Text style={styles.statusTime}>
              {lastSync.time.toLocaleString('zh-CN')}
            </Text>
            <Text style={styles.statusDetail}>
              创建 {lastSync.events} 个事件
              {lastSync.errors > 0 ? `，${lastSync.errors} 个失败` : ''}
            </Text>
          </View>
        ) : (
          <View style={styles.statusCard}>
            <Ionicons name="sync-outline" size={48} color="#4F46E5" />
            <Text style={styles.statusTitle}>未同步</Text>
            <Text style={styles.statusDetail}>
              在订阅列表中开启日历图标，然后点此同步
            </Text>
          </View>
        )}

        {/* 闹钟设置 */}
        <View style={styles.alarmCard}>
          <Ionicons name="alarm-outline" size={18} color="#6B7280" />
          <Text style={styles.alarmLabel}>事件开始时提前</Text>
          <View style={styles.alarmInputRow}>
            <TextInput
              style={styles.alarmInput}
              value={alarmMinutes === 0 ? '' : String(alarmMinutes)}
              onChangeText={updateAlarm}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor="#9CA3AF"
            />
            <Text style={styles.alarmSuffix}>分钟提醒</Text>
          </View>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>同步说明</Text>
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={16} color="#6B7280" />
            <Text style={styles.infoText}>在系统日历中创建独立日历「SubsTracker」</Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="refresh-outline" size={16} color="#6B7280" />
            <Text style={styles.infoText}>每次同步先清空再重建，保证数据一致</Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="toggle-outline" size={16} color="#6B7280" />
            <Text style={styles.infoText}>仅同步订阅列表中开启了日历开关的订阅</Text>
          </View>
          {Platform.OS === 'android' && (
            <View style={styles.infoRow}>
              <Ionicons name="warning-outline" size={16} color="#F59E0B" />
              <Text style={styles.infoText}>Android 首次使用需授予日历权限</Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[styles.syncButton, loading && styles.syncButtonLoading]}
          onPress={loadAndSync}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Ionicons name="sync" size={20} color="#FFFFFF" />
          )}
          <Text style={styles.syncText}>
            {loading ? '同步中...' : lastSync ? '再次同步' : '开始同步'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    paddingTop: 60,
    paddingBottom: 16,
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: { fontSize: 28, fontWeight: '700', color: '#111827' },
  content: { flex: 1, padding: 16, alignItems: 'center', justifyContent: 'center' },
  statusCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    width: '100%',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  statusTitle: { fontSize: 16, fontWeight: '600', color: '#111827', marginTop: 12 },
  statusTime: { fontSize: 13, color: '#6B7280', marginTop: 4 },
  statusDetail: {
    fontSize: 14,
    color: '#374151',
    marginTop: 8,
    textAlign: 'center',
  },
  alarmCard: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    marginBottom: 12,
    gap: 8,
  },
  alarmLabel: { fontSize: 14, color: '#374151', fontWeight: '500' },
  alarmInputRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  alarmInput: {
    width: 56,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#F9FAFB',
  },
  alarmSuffix: { fontSize: 13, color: '#6B7280' },
  infoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    marginBottom: 24,
    gap: 10,
  },
  infoTitle: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 4 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoText: { fontSize: 13, color: '#6B7280', flex: 1, lineHeight: 18 },
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#4F46E5',
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 12,
    width: '100%',
  },
  syncButtonLoading: { opacity: 0.7 },
  syncText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});
