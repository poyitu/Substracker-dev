// ============================================================
// 日历同步
// ============================================================

import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
  TextInput,
  ScrollView,
  Switch,
} from 'react-native';
import { useState, useCallback, useEffect } from 'react';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from '../../src/api/client';
import { useAuth } from '../../src/stores/auth';
import {
  requestCalendarPermission,
  syncCalendar,
  saveAlarmMinutes,
  getAlarmMinutes,
} from '../../src/lib/calendar';
import type { Subscription } from '../../src/types';

const LAST_SYNC_KEY = 'substracker_last_calendar_sync';

export default function CalendarScreen() {
  const { isLoggedIn } = useAuth();
  const [loading, setLoading] = useState(false);
  const [alarmMinutes, setAlarmMinutes] = useState(0);
  const [lastSync, setLastSync] = useState<{ time: Date; events: number; errors: number } | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);

  // 读取闹钟与上次同步记录
  useEffect(() => {
    getAlarmMinutes().then(setAlarmMinutes);
    AsyncStorage.getItem(LAST_SYNC_KEY).then((raw) => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          setLastSync({
            time: new Date(parsed.time),
            events: parsed.events,
            errors: parsed.errors,
          });
        } catch {}
      }
    });
  }, []);

  const loadSubscriptions = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      const subs = await apiClient.getSubscriptions();
      setSubscriptions(subs);
    } catch (err) {
      console.warn('[Calendar] 加载订阅列表失败:', err);
    }
  }, [isLoggedIn]);

  useFocusEffect(
    useCallback(() => {
      loadSubscriptions();
    }, [loadSubscriptions]),
  );

  const updateAlarm = async (v: string) => {
    const n = v === '' ? 0 : parseInt(v, 10);
    if (isNaN(n) || n < 0) return;
    setAlarmMinutes(n);
    await saveAlarmMinutes(n);
  };

  const handleToggleSync = async (sub: Subscription) => {
    const newVal = !sub.syncToCalendar;
    setSubscriptions((prev) =>
      prev.map((s) => (s.id === sub.id ? { ...s, syncToCalendar: newVal } : s)),
    );
    try {
      await apiClient.toggleCalendarSync(sub.id, newVal);
    } catch (err: any) {
      // 回滚
      setSubscriptions((prev) =>
        prev.map((s) => (s.id === sub.id ? { ...s, syncToCalendar: !newVal } : s)),
      );
      Alert.alert('更新失败', err.message || '网络请求异常');
    }
  };

  const loadAndSync = useCallback(async () => {
    if (!isLoggedIn) return;
    setLoading(true);
    try {
      const permResult = await requestCalendarPermission();
      if (!permResult.granted) {
        Alert.alert('权限不足', `需要日历权限才能同步提醒日程\n\n诊断: ${permResult.diagnosis}`);
        return;
      }

      const subs: Subscription[] = await apiClient.getSubscriptions();
      setSubscriptions(subs);

      const withCalendar = subs.filter((s) => s.syncToCalendar);
      if (withCalendar.length === 0) {
        Alert.alert('提示', '没有开启日历同步的订阅，请在下方勾选参与同步的订阅');
        return;
      }

      const result = await syncCalendar(subs, alarmMinutes);
      const syncInfo = { time: new Date(), events: result.eventsCreated, errors: result.errors };
      setLastSync(syncInfo);
      await AsyncStorage.setItem(
        LAST_SYNC_KEY,
        JSON.stringify({
          time: syncInfo.time.toISOString(),
          events: syncInfo.events,
          errors: syncInfo.errors,
        }),
      );

      const msg =
        result.errors > 0
          ? `已创建 ${result.eventsCreated} 个日历事件，${result.errors} 个失败${result.lastError ? `\n\n错误原因: ${result.lastError}` : ''}`
          : `已成功同步 ${result.eventsCreated} 个日历事件到系统日历`;
      Alert.alert(result.eventsCreated > 0 ? '同步完成' : '同步异常', msg);
    } catch (err: any) {
      Alert.alert('同步失败', err.message || '请重试');
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn, alarmMinutes]);

  const enabledCount = subscriptions.filter((s) => s.syncToCalendar).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>日历同步</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {lastSync ? (
          <View style={styles.statusCard}>
            <Ionicons name="checkmark-circle" size={44} color="#10B981" />
            <Text style={styles.statusTitle}>系统日历同步状态</Text>
            <Text style={styles.statusTime}>
              上次同步: {lastSync.time.toLocaleString('zh-CN')}
            </Text>
            <Text style={styles.statusDetail}>
              成功创建 {lastSync.events} 个事件
              {lastSync.errors > 0 ? `，${lastSync.errors} 个创建失败` : ''}
            </Text>
          </View>
        ) : (
          <View style={styles.statusCard}>
            <Ionicons name="sync-outline" size={44} color="#4F46E5" />
            <Text style={styles.statusTitle}>未生成日历日程</Text>
            <Text style={styles.statusDetail}>
              开启下方订阅开关，点击「开始同步」即可写入手机自带日历
            </Text>
          </View>
        )}

        {/* 同步按钮 */}
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
            {loading ? '正在写入系统日历...' : lastSync ? '再次同步' : '开始同步到系统日历'}
          </Text>
        </TouchableOpacity>

        {/* 闹钟设置 */}
        <View style={styles.alarmCard}>
          <View style={styles.alarmTitleRow}>
            <Ionicons name="alarm-outline" size={18} color="#4F46E5" />
            <Text style={styles.alarmLabel}>事件响铃提醒提前量</Text>
          </View>
          <View style={styles.alarmInputRow}>
            <Text style={styles.alarmSubtext}>事件开始前</Text>
            <TextInput
              style={styles.alarmInput}
              value={alarmMinutes === 0 ? '' : String(alarmMinutes)}
              onChangeText={updateAlarm}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor="#9CA3AF"
            />
            <Text style={styles.alarmSuffix}>分钟触发手机闹钟/通知</Text>
          </View>
        </View>

        {/* 参与同步的订阅管理 */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>同步到日历的订阅</Text>
            <Text style={styles.sectionBadge}>
              {enabledCount} / {subscriptions.length} 已开启
            </Text>
          </View>
          {subscriptions.length > 0 ? (
            subscriptions.map((sub) => (
              <View key={sub.id} style={styles.subRow}>
                <View style={styles.subLeft}>
                  <Text style={styles.subName}>{sub.name}</Text>
                  <Text style={styles.subMeta}>
                    {sub.category || '未分类'} · 到期日:{' '}
                    {new Date(sub.expiryDate).toLocaleDateString('zh-CN')}
                  </Text>
                </View>
                <Switch
                  value={!!sub.syncToCalendar}
                  onValueChange={() => handleToggleSync(sub)}
                  trackColor={{ false: '#D1D5DB', true: '#818CF8' }}
                  thumbColor={sub.syncToCalendar ? '#4F46E5' : '#F9FAFB'}
                />
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>暂无订阅数据</Text>
          )}
        </View>

        {/* 说明 */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>系统日历同步说明</Text>
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={16} color="#6B7280" />
            <Text style={styles.infoText}>
              在系统日历中自动新建独立日历分类「SubsTracker」，不干扰个人日历。
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="refresh-outline" size={16} color="#6B7280" />
            <Text style={styles.infoText}>每次同步全量清空旧事件并重建，确保与订阅规则绝对一致。</Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="notifications-outline" size={16} color="#6B7280" />
            <Text style={styles.infoText}>即使 App 未在后台运行，手机系统日历也会准时发出提醒。</Text>
          </View>
          {Platform.OS === 'android' && (
            <View style={styles.infoRow}>
              <Ionicons name="warning-outline" size={16} color="#F59E0B" />
              <Text style={styles.infoText}>Android 首次同步时请选择允许写入日历权限。</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    paddingTop: Platform.OS === 'ios' ? 60 : 44,
    paddingBottom: 16,
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: { fontSize: 24, fontWeight: '700', color: '#111827' },
  content: { padding: 16, paddingBottom: 40 },
  statusCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  statusTitle: { fontSize: 16, fontWeight: '600', color: '#111827', marginTop: 8 },
  statusTime: { fontSize: 13, color: '#6B7280', marginTop: 4 },
  statusDetail: {
    fontSize: 13,
    color: '#374151',
    marginTop: 6,
    textAlign: 'center',
  },
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#4F46E5',
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 16,
  },
  syncButtonLoading: { opacity: 0.7 },
  syncText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  alarmCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    gap: 10,
  },
  alarmTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  alarmLabel: { fontSize: 14, color: '#111827', fontWeight: '600' },
  alarmInputRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  alarmSubtext: { fontSize: 13, color: '#6B7280' },
  alarmInput: {
    width: 52,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 4,
    fontSize: 14,
    color: '#111827',
    backgroundColor: '#F9FAFB',
  },
  alarmSuffix: { fontSize: 13, color: '#6B7280' },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#111827' },
  sectionBadge: { fontSize: 12, color: '#4F46E5', fontWeight: '500' },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  subLeft: { flex: 1, marginRight: 12 },
  subName: { fontSize: 14, fontWeight: '600', color: '#111827' },
  subMeta: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  emptyText: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', paddingVertical: 12 },
  infoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  infoTitle: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 4 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  infoText: { fontSize: 13, color: '#6B7280', flex: 1, lineHeight: 18 },
});

