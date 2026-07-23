// ============================================================
// 日历同步
// ============================================================

import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Platform } from 'react-native';
import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../../src/api/client';
import { useAuth } from '../../src/stores/auth';
import { requestCalendarPermission, syncCalendar } from '../../src/lib/calendar';
import type { Subscription } from '../../src/types';

export default function CalendarScreen() {
  const { isLoggedIn } = useAuth();
  const [loading, setLoading] = useState(false);
  const [lastSync, setLastSync] = useState<{ time: Date; events: number; errors: number } | null>(null);

  const loadAndSync = useCallback(async () => {
    if (!isLoggedIn) return;
    setLoading(true);
    try {
      // 权限检查
      const permitted = await requestCalendarPermission();
      if (!permitted) {
        Alert.alert('权限不足', '需要日历权限才能同步提醒');
        return;
      }

      // 加载订阅
      const subs: Subscription[] = await apiClient.getSubscriptions();
      if (subs.length === 0) {
        Alert.alert('提示', '暂无订阅数据');
        return;
      }

      // 同步
      const result = await syncCalendar(subs);
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
  }, [isLoggedIn]);

  useFocusEffect(
    useCallback(() => {
      // 首次进入不自动同步，让用户手动触发
    }, []),
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
              点击下方按钮将订阅提醒同步到系统日历
            </Text>
          </View>
        )}

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>同步说明</Text>
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={16} color="#6B7280" />
            <Text style={styles.infoText}>在系统日历中创建独立日历「SubsTracker」</Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="refresh-outline" size={16} color="#6B7280" />
            <Text style={styles.infoText}>
              每次同步先清空再重建，保证数据一致
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="list-outline" size={16} color="#6B7280" />
            <Text style={styles.infoText}>每条提醒规则对应一个日历事件</Text>
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
