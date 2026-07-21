// ============================================================
// 首页仪表盘
// V1: 即将到期 / 本月到期 / 总订阅 / 月花费
// ============================================================

import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../../src/api/client';
import { useAuth } from '../../src/stores/auth';
import { isUpcomingSubscription, getDaysBetween } from '../../src/lib/time';
import { readCache, writeCache } from '../../src/lib/cache';
import type { DashboardStats } from '../../src/types';

export default function HomeScreen() {
  const { isLoggedIn } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const loadStats = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      const [dashboard, subs] = await Promise.all([
        apiClient.getDashboardStats(),
        apiClient.getSubscriptions(),
      ]);
      const timezone = dashboard.timezone || 'UTC';
      const upcoming = subs
        .filter((sub) => isUpcomingSubscription(sub, timezone))
        .map((sub) => {
          const daysRemaining = Math.max(0, getDaysBetween(new Date(), sub.expiryDate, timezone));
          return {
            id: sub.id,
            name: sub.name,
            daysRemaining,
            expiryDate: sub.expiryDate,
          };
        })
        .sort((a, b) => a.daysRemaining - b.daysRemaining);
      setStats({
        ...dashboard,
        upcoming,
      });
      writeCache('dashboard', { ...dashboard, upcoming });
    } catch (err) {
      console.warn('[Home] 加载仪表盘失败:', err);
    }
  }, [isLoggedIn]);

  // 每次获得焦点时刷新（含首次挂载）
  useFocusEffect(
    useCallback(() => {
      if (!isLoggedIn) return;
      let cancelled = false;
      readCache<DashboardStats>('dashboard').then((cached) => {
        if (!cancelled && cached) setStats(cached);
      });
      loadStats();
      return () => {
        cancelled = true;
      };
    }, [loadStats]),
  );
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadStats();
    setRefreshing(false);
  }, [loadStats]);

  const upcomingCount = stats?.upcoming?.length ?? 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>SubsTracker</Text>
        <Text style={styles.headerSubtitle}>订阅管理，尽在掌握</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* 统计卡片 */}
        <View style={styles.statsGrid}>
          <View style={[styles.statCard, styles.cardDanger]}>
            <Ionicons name="alert-circle" size={24} color="#EF4444" />
            <Text style={styles.statNumber}>{upcomingCount}</Text>
            <Text style={styles.statLabel}>即将到期</Text>
          </View>
          <View style={[styles.statCard, styles.cardWarning]}>
            <Ionicons name="calendar" size={24} color="#F59E0B" />
            <Text style={styles.statNumber}>{stats?.expiringThisMonth ?? 0}</Text>
            <Text style={styles.statLabel}>本月到期</Text>
          </View>
          <View style={[styles.statCard, styles.cardInfo]}>
            <Ionicons name="layers" size={24} color="#6366F1" />
            <Text style={styles.statNumber}>{stats?.total ?? 0}</Text>
            <Text style={styles.statLabel}>总订阅</Text>
          </View>
          <View style={[styles.statCard, styles.cardSuccess]}>
            <Ionicons name="wallet" size={24} color="#10B981" />
            <Text style={styles.statNumber}>
              {stats?.totalMonthlyCost != null
                ? `¥${Number(stats.totalMonthlyCost).toFixed(0)}`
                : '--'}
            </Text>
            <Text style={styles.statLabel}>月花费</Text>
          </View>
        </View>

        {/* 即将到期订阅 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>即将到期</Text>
          {stats?.upcoming?.length ? (
            stats.upcoming.map((sub) => (
              <TouchableOpacity key={sub.id} style={styles.upcomingItem}>
                <View style={styles.upcomingLeft}>
                  <Text style={styles.upcomingName}>{sub.name}</Text>
                  <Text style={styles.upcomingDate}>
                    到期: {new Date(sub.expiryDate).toLocaleDateString('zh-CN')}
                  </Text>
                </View>
                <View
                  style={[
                    styles.daysBadge,
                    sub.daysRemaining <= 0
                      ? styles.daysBadgeDanger
                      : sub.daysRemaining <= 3
                        ? styles.daysBadgeWarning
                        : styles.daysBadgeInfo,
                  ]}
                >
                  <Text style={styles.daysText}>
                    {sub.daysRemaining === 0 ? '今天' : `${sub.daysRemaining}天`}
                  </Text>
                </View>
              </TouchableOpacity>
            ))
          ) : (
            <Text style={styles.emptyText}>暂无即将到期的订阅</Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
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
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 100 },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    width: '47%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardDanger: { borderLeftWidth: 3, borderLeftColor: '#EF4444' },
  cardWarning: { borderLeftWidth: 3, borderLeftColor: '#F59E0B' },
  cardInfo: { borderLeftWidth: 3, borderLeftColor: '#6366F1' },
  cardSuccess: { borderLeftWidth: 3, borderLeftColor: '#10B981' },
  statNumber: { fontSize: 28, fontWeight: '700', color: '#111827', marginTop: 8 },
  statLabel: { fontSize: 12, color: '#6B7280', marginTop: 4 },
  section: { marginTop: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#111827', marginBottom: 12 },
  upcomingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  upcomingLeft: { flex: 1 },
  upcomingName: { fontSize: 15, fontWeight: '600', color: '#111827' },
  upcomingDate: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  daysBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  daysBadgeDanger: { backgroundColor: '#FEE2E2' },
  daysBadgeWarning: { backgroundColor: '#FEF3C7' },
  daysBadgeInfo: { backgroundColor: '#E0E7FF' },
  daysText: { fontSize: 13, fontWeight: '600', color: '#374151' },
  emptyText: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', marginTop: 20 },
});
