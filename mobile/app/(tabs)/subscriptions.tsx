// ============================================================
// 订阅列表
// V1: 分类筛选 + 搜索 + 滑动操作 + FAB 添加
// ============================================================

import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  Alert,
  Switch,
} from 'react-native';
import { useState, useCallback } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../../src/api/client';
import { useAuth } from '../../src/stores/auth';
import { readCache, writeCache } from '../../src/lib/cache';
import SwipeableRow from '../../src/components/SwipeableRow';
import type { Subscription } from '../../src/types';

const PRESET_CATEGORIES = [
  '全部',
  '视频',
  '音乐',
  '云存储',
  '工具',
  '会员',
  '其他',
];

export default function SubscriptionsScreen() {
  const { isLoggedIn } = useAuth();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('全部');

  const loadSubscriptions = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      const subs = await apiClient.getSubscriptions();
      setSubscriptions(subs);
      writeCache('subscriptions', subs);
    } catch (err) {
      console.warn('[Subscriptions] 加载失败:', err);
    }
  }, [isLoggedIn]);

  // 每次 Tab 获得焦点时：先显示缓存，再后台刷新
  useFocusEffect(
    useCallback(() => {
      if (!isLoggedIn) return;
      let cancelled = false;
      readCache<Subscription[]>('subscriptions').then((cached) => {
        if (!cancelled && cached) setSubscriptions(cached);
      });
      loadSubscriptions();
      return () => {
        cancelled = true;
      };
    }, [loadSubscriptions]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadSubscriptions();
    setRefreshing(false);
  }, [loadSubscriptions]);

  const filtered = subscriptions.filter((sub) => {
    if (selectedCategory !== '全部' && sub.category !== selectedCategory) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        sub.name.toLowerCase().includes(q) ||
        (sub.category || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleCalendarToggle = async (sub: Subscription) => {
    const newVal = !sub.syncToCalendar;
    // 乐观更新
    setSubscriptions((prev) =>
      prev.map((s) => (s.id === sub.id ? { ...s, syncToCalendar: newVal } : s)),
    );
    try {
      await apiClient.toggleCalendarSync(sub.id, newVal);
    } catch {
      // 回滚
      setSubscriptions((prev) =>
        prev.map((s) => (s.id === sub.id ? { ...s, syncToCalendar: !newVal } : s)),
      );
    }
  };

  const handleDelete = (sub: Subscription) => {
    Alert.alert('删除订阅', `确定要删除「${sub.name}」吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiClient.deleteSubscription(sub.id);
            loadSubscriptions();
          } catch (err: any) {
            Alert.alert('删除失败', err.message);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>我的订阅</Text>
        <Text style={styles.headerSubtitle}>{subscriptions.length} 个订阅</Text>
      </View>

      {/* Search */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color="#9CA3AF" />
        <TextInput
          style={styles.searchInput}
          placeholder="搜索订阅..."
          value={search}
          onChangeText={setSearch}
          placeholderTextColor="#9CA3AF"
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color="#9CA3AF" />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Category Filter */}
      <View style={styles.categoryRow}>
        {PRESET_CATEGORIES.map((item) => (
          <TouchableOpacity
            key={item}
            style={[
              styles.categoryChip,
              selectedCategory === item && styles.categoryChipActive,
            ]}
            onPress={() => setSelectedCategory(item)}
          >
            <Text
              style={[
                styles.categoryText,
                selectedCategory === item && styles.categoryTextActive,
              ]}
            >
              {item}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Subscription List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <SwipeableRow
            onDelete={() => handleDelete(item)}
            onPress={() => router.push(`/edit/${item.id}`)}
          >
            <View style={styles.subItem}>
              <View style={styles.subLeft}>
                <View
                  style={[styles.dot, item.isActive ? styles.dotActive : styles.dotInactive]}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.subName}>{item.name}</Text>
                  <Text style={styles.subMeta}>
                    {item.category || '未分类'} · {item.periodValue || 1}
                    {item.periodUnit === 'month' ? '月' : item.periodUnit === 'year' ? '年' : '天'}
                  </Text>
                </View>
              </View>
              <View style={styles.subRight}>
                <Text style={styles.subExpiry}>
                  {new Date(item.expiryDate).toLocaleDateString('zh-CN')}
                </Text>
                <Switch
                  value={!!item.syncToCalendar}
                  onValueChange={() => handleCalendarToggle(item)}
                  trackColor={{ false: '#D1D5DB', true: '#818CF8' }}
                  thumbColor={item.syncToCalendar ? '#4F46E5' : '#F9FAFB'}
                  style={styles.calendarSwitch}
                />
              </View>
            </View>
          </SwipeableRow>
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.emptyText}>暂无订阅</Text>}
      />

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={() => router.push('/add')}>
        <Ionicons name="add" size={24} color="#FFFFFF" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: { fontSize: 28, fontWeight: '700', color: '#111827' },
  headerSubtitle: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    height: 40,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 15,
    color: '#111827',
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  categoryChipActive: {
    backgroundColor: '#4F46E5',
    borderColor: '#4F46E5',
  },
  categoryText: { fontSize: 13, color: '#6B7280', fontWeight: '500' },
  categoryTextActive: { color: '#FFFFFF' },
  listContent: { paddingHorizontal: 16, paddingBottom: 100 },
  subItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  subLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 12,
  },
  dotActive: { backgroundColor: '#10B981' },
  dotInactive: { backgroundColor: '#D1D5DB' },
  subName: { fontSize: 15, fontWeight: '600', color: '#111827' },
  subMeta: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  subRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  subExpiry: { fontSize: 13, color: '#6B7280' },
  calendarSwitch: { transform: [{ scaleX: 0.75 }, { scaleY: 0.75 }] },
  emptyText: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', marginTop: 40 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#4F46E5',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#4F46E5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
});
