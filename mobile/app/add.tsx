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
  StatusBar,
  Modal,
  Pressable,
} from 'react-native';
import { useState, useEffect } from 'react';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from '../src/api/client';
import type { ReminderRule } from '../src/types';

const CATEGORIES = ['视频', '音乐', '云存储', '工具', '会员', '其他'];
const PERIOD_UNITS: Array<'day' | 'month' | 'year'> = ['day', 'month', 'year'];
const MODE_KEY = 'substracker.lastSubscriptionMode';
const MODE_OPTIONS: Array<{ value: 'cycle' | 'reset' | 'no_renew'; label: string }> = [
  { value: 'cycle', label: '循环订阅' },
  { value: 'reset', label: '到期重置' },
  { value: 'no_renew', label: '一次性' },
];
export default function AddScreen() {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('其他');
  const [amount, setAmount] = useState('');
  const [periodValue, setPeriodValue] = useState('1');
  const [periodUnit, setPeriodUnit] = useState<'day' | 'month' | 'year'>('month');
  const [expiryDate, setExpiryDate] = useState(new Date());
  const [subscriptionMode, setSubscriptionMode] = useState<'cycle' | 'reset' | 'no_renew'>('cycle');
  const [autoRenew, setAutoRenew] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reminderRules, setReminderRules] = useState<ReminderRule[]>([]);
  const [showRulePicker, setShowRulePicker] = useState(false);
  const [showDaysPicker, setShowDaysPicker] = useState<string | null>(null);
  const [daysPickerValue, setDaysPickerValue] = useState('');

  // 加载上次选择的订阅模式
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(MODE_KEY);
        if (saved === 'cycle' || saved === 'reset' || saved === 'no_renew') {
          setSubscriptionMode(saved);
          if (saved === 'no_renew') {
            setAutoRenew(false);
          }
        }
      } catch {}
    })();
  }, []);

  const handleModeChange = (mode: 'cycle' | 'reset' | 'no_renew') => {
    setSubscriptionMode(mode);
    AsyncStorage.setItem(MODE_KEY, mode).catch(() => {});
    if (mode === 'no_renew') {
      setAutoRenew(false);
    }
  };

  // ---- 提醒规则 ----
  const makeLocalRuleId = () => `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // 初始化默认提醒规则（仅 1天 + 到期当天，均不开启）
  useEffect(() => {
    setReminderRules([
      { id: makeLocalRuleId(), type: 'before_expiry', value: 1, unit: 'days', isEnabled: false, repeatInterval: null, repeatUntil: 'renewed' },
      { id: makeLocalRuleId(), type: 'on_expiry', value: 0, unit: 'days', isEnabled: false, repeatInterval: null, repeatUntil: 'renewed' },
    ]);
  }, []);

  const toggleRule = (ruleId: string) => {
    setReminderRules((prev) =>
      prev.map((r) => (r.id === ruleId ? { ...r, isEnabled: !r.isEnabled } : r)),
    );
  };

  const updateRuleDays = (ruleId: string, text: string) => {
    const n = parseInt(text, 10);
    if (text !== '' && !isNaN(n)) {
      setReminderRules((prev) =>
        prev.map((r) => (r.id === ruleId ? { ...r, value: Math.max(0, n) } : r)),
      );
    }
  };

  const openDaysPicker = (ruleId: string, currentValue: number) => {
    setDaysPickerValue(String(currentValue));
    setShowDaysPicker(ruleId);
  };

  const confirmDaysPicker = () => {
    if (showDaysPicker) {
      const n = parseInt(daysPickerValue, 10);
      if (!isNaN(n) && n >= 0) {
        setReminderRules((prev) =>
          prev.map((r) => (r.id === showDaysPicker ? { ...r, value: n } : r)),
        );
      }
      setShowDaysPicker(null);
      setDaysPickerValue('');
    }
  };

  const updateRuleHours = (ruleId: string, text: string) => {
    const hours = text
      .split(/[,，\s]+/)
      .map((h) => parseInt(h, 10))
      .filter((h) => !isNaN(h) && h >= 0 && h <= 23);
    setReminderRules((prev) =>
      prev.map((r) => (r.id === ruleId ? { ...r, hours } : r)),
    );
  };

  const addRule = (type: ReminderRule['type']) => {
    const rule: ReminderRule = {
      id: makeLocalRuleId(),
      type,
      value: type === 'on_expiry' || type === 'on_expiry_at' ? 0 : 7,
      unit: 'days',
      isEnabled: true,
      repeatInterval: null,
      repeatUntil: 'renewed',
      ...(type === 'on_expiry_at' ? { hours: [9, 18] } : {}),
    };
    setReminderRules((prev) => [...prev, rule]);
    setShowRulePicker(false);
  };

  const deleteRule = (ruleId: string) => {
    setReminderRules((prev) => prev.filter((r) => r.id !== ruleId));
  };

  const ruleLabel = (rule: ReminderRule) => {
    if (rule.type === 'on_expiry') return '到期当天';
    if (rule.type === 'on_expiry_at') return `到期当天 ${(rule.hours || []).join(', ')}点`;
    if (rule.type === 'before_expiry') return `提前 ${rule.value} 天`;
    return `${rule.type} ${rule.value}${rule.unit === 'hours' ? '小时' : '天'}`;
  };

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
        subscriptionMode,
        expiryDate: expiryDate.toISOString(),
        category,
        amount: amount ? Number(amount) : undefined,
        currency: 'CNY',
        periodValue: Number(periodValue),
        periodUnit,
        reminderRules,
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

        {/* Subscription Mode */}
        <View style={styles.field}>
          <Text style={styles.label}>订阅模式</Text>
          <View style={styles.chipRow}>
            {MODE_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.chip, subscriptionMode === opt.value && styles.chipActive]}
                onPress={() => handleModeChange(opt.value)}
              >
                <Text style={[styles.chipText, subscriptionMode === opt.value && styles.chipTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {subscriptionMode === 'no_renew' && (
            <Text style={styles.switchHint}>一次性订阅到期后不再提醒也不自动续订</Text>
          )}
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
            disabled={subscriptionMode === 'no_renew'}
            trackColor={{ false: '#D1D5DB', true: '#818CF8' }}
            thumbColor={autoRenew ? '#4F46E5' : '#F9FAFB'}
          />
        </View>

        {/* 提醒规则 */}
        <View style={styles.field}>
          <View style={styles.reminderHeader}>
            <Text style={styles.label}>提醒规则</Text>
            <TouchableOpacity onPress={() => setShowRulePicker(true)}>
              <Ionicons name="add-circle" size={22} color="#4F46E5" />
            </TouchableOpacity>
          </View>
          {reminderRules.length > 0 ? (
            reminderRules.map((rule) => (
              <View key={rule.id} style={styles.reminderRow}>
                <View style={styles.reminderLeft}>
                  {rule.type === 'before_expiry' ? (
                    <View style={styles.reminderDaysRow}>
                      <Text style={styles.reminderPrefix}>提前</Text>
                      <TouchableOpacity
                        style={styles.reminderDaysBtn}
                        onPress={() => {
                          if (!rule.isEnabled) return;
                          openDaysPicker(rule.id, rule.value);
                        }}
                        disabled={!rule.isEnabled}
                      >
                        <Text style={styles.reminderDaysBtnText}>{rule.value}</Text>
                        <Ionicons name="chevron-down" size={12} color="#9CA3AF" />
                      </TouchableOpacity>
                      <Text style={styles.reminderSuffix}>天</Text>
                    </View>
                  ) : rule.type === 'on_expiry_at' ? (
                    <View style={styles.reminderDaysRow}>
                      <Text style={styles.reminderPrefix}>到期当天</Text>
                      <TextInput
                        style={[styles.reminderDaysInput, styles.hoursInput]}
                        value={(rule.hours || []).join(', ')}
                        onChangeText={(t) => updateRuleHours(rule.id, t)}
                        placeholder="如 9, 18"
                        placeholderTextColor="#9CA3AF"
                        editable={rule.isEnabled}
                        keyboardType="number-pad"
                      />
                      <Text style={styles.reminderSuffix}>点</Text>
                    </View>
                  ) : (
                    <Text
                      style={[
                        styles.reminderLabel,
                        !rule.isEnabled && styles.reminderLabelDisabled,
                      ]}
                    >
                      {ruleLabel(rule)}
                    </Text>
                  )}
                </View>
                <View style={styles.reminderActions}>
                  <Switch
                    value={rule.isEnabled}
                    onValueChange={() => toggleRule(rule.id)}
                    trackColor={{ false: '#D1D5DB', true: '#818CF8' }}
                    thumbColor={rule.isEnabled ? '#4F46E5' : '#F9FAFB'}
                  />
                  <TouchableOpacity onPress={() => deleteRule(rule.id)} style={styles.reminderDeleteBtn}>
                    <Ionicons name="trash-outline" size={16} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.emptyHint}>暂无提醒（点击右上 + 添加）</Text>
          )}
        </View>
      </ScrollView>

      {/* 提醒类型选择弹窗 */}
      <Modal visible={showRulePicker} transparent animationType="fade">
        <Pressable
          style={styles.rulePickerOverlay}
          onPress={() => setShowRulePicker(false)}
        >
          <View style={styles.rulePickerContent}>
            <Text style={styles.rulePickerTitle}>添加提醒</Text>
            {([
              { type: 'before_expiry' as const, label: '提前N天', icon: 'time-outline' as const },
              { type: 'on_expiry' as const, label: '到期当天', icon: 'calendar-outline' as const },
              { type: 'on_expiry_at' as const, label: '到期当天指定时间', icon: 'alarm-outline' as const },
            ]).map((opt) => (
              <Pressable
                key={opt.type}
                style={styles.rulePickerOption}
                onPress={() => addRule(opt.type)}
              >
                <Ionicons name={opt.icon} size={18} color="#4F46E5" />
                <Text style={styles.rulePickerOptionText}>{opt.label}</Text>
              </Pressable>
            ))}
            <Pressable
              style={styles.rulePickerCancel}
              onPress={() => setShowRulePicker(false)}
            >
              <Text style={styles.rulePickerCancelText}>取消</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* 天数选择弹窗 */}
      <Modal visible={showDaysPicker !== null} transparent animationType="fade">
        <Pressable
          style={styles.rulePickerOverlay}
          onPress={() => setShowDaysPicker(null)}
        >
          <View style={styles.rulePickerContent}>
            <Text style={styles.rulePickerTitle}>选择天数</Text>
            <View style={styles.daysChipRow}>
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <TouchableOpacity
                  key={d}
                  style={[
                    styles.daysChip,
                    daysPickerValue === String(d) && styles.daysChipActive,
                  ]}
                  onPress={() => setDaysPickerValue(String(d))}
                >
                  <Text
                    style={[
                      styles.daysChipText,
                      daysPickerValue === String(d) && styles.daysChipTextActive,
                    ]}
                  >
                    {d}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.customDaysRow}>
              <Text style={styles.customDaysLabel}>自定义:</Text>
              <TextInput
                style={styles.customDaysInput}
                value={daysPickerValue}
                onChangeText={setDaysPickerValue}
                keyboardType="number-pad"
                placeholder="天数"
                placeholderTextColor="#9CA3AF"
              />
              <Text style={styles.customDaysSuffix}>天</Text>
            </View>
            <View style={styles.daysPickerActions}>
              <Pressable
                style={styles.daysPickerCancel}
                onPress={() => setShowDaysPicker(null)}
              >
                <Text style={styles.daysPickerCancelText}>取消</Text>
              </Pressable>
              <Pressable style={styles.daysPickerConfirm} onPress={confirmDaysPicker}>
                <Text style={styles.daysPickerConfirmText}>确定</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 60 : (StatusBar.currentHeight || 24) + 12,
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
  // -- 提醒规则 --
  reminderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  reminderLeft: { flex: 1 },
  reminderDaysRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  reminderPrefix: { fontSize: 14, color: '#374151' },
  reminderSuffix: { fontSize: 14, color: '#374151' },
  reminderDaysInput: {
    backgroundColor: '#F9FAFB',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 14,
    color: '#111827',
    width: 48,
    textAlign: 'center',
  },
  hoursInput: { width: 96 },
  reminderLabel: { fontSize: 14, color: '#374151' },
  reminderLabelDisabled: { color: '#D1D5DB' },
  reminderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  reminderDeleteBtn: {
    padding: 4,
  },
  emptyHint: { fontSize: 13, color: '#9CA3AF', marginTop: 4 },
  // -- 提醒类型选择弹窗 --
  rulePickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  rulePickerContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 36,
    gap: 4,
  },
  rulePickerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
    textAlign: 'center',
  },
  rulePickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: '#F9FAFB',
  },
  rulePickerOptionText: { fontSize: 15, color: '#374151', fontWeight: '500' },
  rulePickerCancel: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
  },
  rulePickerCancelText: { fontSize: 15, fontWeight: '600', color: '#374151' },
  // -- 天数选择 --
  reminderDaysBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#F9FAFB',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 48,
    justifyContent: 'center',
  },
  reminderDaysBtnText: { fontSize: 14, color: '#111827', fontWeight: '600' },
  daysChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    marginVertical: 8,
  },
  daysChip: {
    width: 44,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  daysChipActive: { backgroundColor: '#4F46E5' },
  daysChipText: { fontSize: 15, color: '#374151', fontWeight: '500' },
  daysChipTextActive: { color: '#FFFFFF' },
  customDaysRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    marginTop: 8,
    marginBottom: 16,
  },
  customDaysLabel: { fontSize: 14, color: '#6B7280' },
  customDaysInput: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    color: '#111827',
    textAlign: 'center',
  },
  customDaysSuffix: { fontSize: 14, color: '#6B7280' },
  daysPickerActions: {
    flexDirection: 'row',
    gap: 12,
  },
  daysPickerCancel: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
  },
  daysPickerCancelText: { fontSize: 15, fontWeight: '600', color: '#374151' },
  daysPickerConfirm: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#4F46E5',
  },
  daysPickerConfirmText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
});
