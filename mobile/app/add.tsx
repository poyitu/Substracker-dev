// ============================================================
// 添加订阅（Modal）
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
  Platform,
} from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { apiClient } from '../src/api/client';

const CATEGORIES = ['视频', '音乐', '云存储', '工具', '会员', '其他'];
const PERIOD_UNITS: Array<'day' | 'month' | 'year'> = ['day', 'month', 'year'];

export default function AddScreen() {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('其他');
  const [amount, setAmount] = useState('');
  const [periodValue, setPeriodValue] = useState('1');
  const [periodUnit, setPeriodUnit] = useState<'day' | 'month' | 'year'>('month');
  const [expiryDate, setExpiryDate] = useState(new Date());
  const [autoRenew, setAutoRenew] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('提示', '请输入订阅名称');
      return;
    }
    setSaving(true);
    try {
      await apiClient.createSubscription({
        id: name.trim().toLowerCase().replace(/\s+/g, '-'),
        name: name.trim(),
        isActive: true,
        autoRenew,
        expiryDate: expiryDate.toISOString(),
        category,
        amount: amount ? Number(amount) : undefined,
        currency: 'CNY',
        periodValue: Number(periodValue),
        periodUnit,
      });
      router.back();
    } catch (err: any) {
      Alert.alert('保存失败', err.message || '请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="close" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>添加订阅</Text>
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
            placeholder="如 Netflix"
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
                style={[
                  styles.chip,
                  category === cat && styles.chipActive,
                ]}
                onPress={() => setCategory(cat)}
              >
                <Text
                  style={[
                    styles.chipText,
                    category === cat && styles.chipTextActive,
                  ]}
                >
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
            <Text style={{ color: '#111827' }}>
              {expiryDate.toLocaleDateString('zh-CN')}
            </Text>
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
              placeholder="0"
              placeholderTextColor="#9CA3AF"
              keyboardType="decimal-pad"
            />
            <Text style={styles.amountSuffix}>/周期</Text>
          </View>
        </View>

        {/* Period */}
        <View style={styles.field}>
          <Text style={styles.label}>周期</Text>
          <View style={styles.periodRow}>
            <TextInput
              style={[styles.input, { width: 60, textAlign: 'center' }]}
              value={periodValue}
              onChangeText={setPeriodValue}
              keyboardType="number-pad"
            />
            <View style={styles.unitRow}>
              {PERIOD_UNITS.map((u) => (
                <TouchableOpacity
                  key={u}
                  style={[styles.unitChip, periodUnit === u && styles.unitChipActive]}
                  onPress={() => setPeriodUnit(u)}
                >
                  <Text
                    style={[
                      styles.unitText,
                      periodUnit === u && styles.unitTextActive,
                    ]}
                  >
                    {{ day: '天', month: '月', year: '年' }[u]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* Auto Renew */}
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
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  currencyPrefix: { fontSize: 15, color: '#6B7280', fontWeight: '500' },
  amountSuffix: { fontSize: 13, color: '#6B7280' },
  periodRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  unitRow: { flexDirection: 'row', gap: 6 },
  unitChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  unitChipActive: { backgroundColor: '#4F46E5' },
  unitText: { fontSize: 13, color: '#6B7280' },
  unitTextActive: { color: '#FFFFFF' },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  switchHint: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
});
