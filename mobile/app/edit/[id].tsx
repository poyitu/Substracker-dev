// ============================================================
// 编辑订阅（Modal）
// V1: 完整编辑表单，结构复用 add 页但预填数据
// ============================================================

import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useState, useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { apiClient } from '../../src/api/client';
import type { Subscription } from '../../src/types';

const CATEGORIES = ['视频', '音乐', '云存储', '工具', '会员', '其他'];

export default function EditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('其他');
  const [amount, setAmount] = useState('');
  const [expiryDate, setExpiryDate] = useState(new Date());
  const [isActive, setIsActive] = useState(true);
  const [autoRenew, setAutoRenew] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const sub = await apiClient.getSubscription(id);
        setName(sub.name || '');
        setCategory(sub.category || '其他');
        setAmount(sub.amount ? String(sub.amount) : '');
        setExpiryDate(new Date(sub.expiryDate));
        setIsActive(sub.isActive);
        setAutoRenew(sub.autoRenew);
      } catch (err: any) {
        Alert.alert('加载失败', err.message);
        router.back();
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('提示', '请输入订阅名称');
      return;
    }
    setSaving(true);
    try {
      await apiClient.updateSubscription(id, {
        name: name.trim(),
        category,
        amount: amount ? Number(amount) : undefined,
        expiryDate: expiryDate.toISOString(),
        isActive,
        autoRenew,
      });
      router.back();
    } catch (err: any) {
      Alert.alert('保存失败', err.message || '请重试');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="close" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>编辑订阅</Text>
        <TouchableOpacity
          onPress={handleSave}
          disabled={saving}
          style={styles.saveButton}
        >
          <Text style={styles.saveText}>{saving ? '保存中...' : '保存'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.form}>
        {/* Name */}
        <View style={styles.field}>
          <Text style={styles.label}>名称 *</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholderTextColor="#9CA3AF"
          />
        </View>

        {/* Category */}
        <View style={styles.field}>
          <Text style={styles.label}>分类</Text>
          <View style={styles.chipRow}>
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[styles.chip, category === cat && styles.chipActive]}
                onPress={() => setCategory(cat)}
              >
                <Text style={[styles.chipText, category === cat && styles.chipTextActive]}>
                  {cat}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Expiry Date */}
        <View style={styles.field}>
          <Text style={styles.label}>到期日期</Text>
          <TouchableOpacity
            style={styles.input}
            onPress={() => setShowDatePicker(true)}
          >
            <Text>{expiryDate.toLocaleDateString('zh-CN')}</Text>
          </TouchableOpacity>
          {showDatePicker && (
            <DateTimePicker
              value={expiryDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_, date) => {
                setShowDatePicker(false);
                if (date) setExpiryDate(date);
              }}
            />
          )}
        </View>

        {/* Amount */}
        <View style={styles.field}>
          <Text style={styles.label}>金额</Text>
          <View style={styles.amountRow}>
            <Text style={styles.currencyPrefix}>¥</Text>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
            />
            <Text style={styles.amountSuffix}>/周期</Text>
          </View>
        </View>

        {/* Switch: Active */}
        <View style={styles.switchRow}>
          <Text style={styles.label}>活跃</Text>
          <Switch
            value={isActive}
            onValueChange={setIsActive}
            trackColor={{ false: '#D1D5DB', true: '#818CF8' }}
            thumbColor={isActive ? '#4F46E5' : '#F9FAFB'}
          />
        </View>

        {/* Switch: Auto Renew */}
        <View style={styles.switchRow}>
          <View>
            <Text style={styles.label}>自动续订</Text>
            <Text style={styles.switchHint}>到期后自动推进到期日</Text>
          </View>
          <Switch
            value={autoRenew}
            onValueChange={setAutoRenew}
            trackColor={{ false: '#D1D5DB', true: '#818CF8' }}
            thumbColor={autoRenew ? '#4F46E5' : '#F9FAFB'}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 60 : 16,
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#111827' },
  saveButton: {
    backgroundColor: '#4F46E5',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  saveText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  form: { padding: 20, gap: 20, paddingBottom: 60 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: '#374151' },
  input: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  chipActive: { backgroundColor: '#4F46E5' },
  chipText: { fontSize: 13, color: '#6B7280' },
  chipTextActive: { color: '#FFFFFF' },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  currencyPrefix: { fontSize: 15, color: '#6B7280', fontWeight: '500' },
  amountSuffix: { fontSize: 13, color: '#6B7280' },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  switchHint: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
});
