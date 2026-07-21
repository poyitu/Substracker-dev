// ============================================================
// 日历同步（暂未开放）
// ============================================================

import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function CalendarScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>日历同步</Text>
      </View>
      <View style={styles.content}>
        <Ionicons name="calendar-outline" size={64} color="#D1D5DB" />
        <Text style={styles.title}>即将上线</Text>
        <Text style={styles.subtitle}>
          订阅到期提醒同步到系统日历的功能将在后续版本中开放
        </Text>
      </View>
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
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  title: { fontSize: 18, fontWeight: '600', color: '#9CA3AF', marginTop: 16 },
  subtitle: {
    fontSize: 14,
    color: '#D1D5DB',
    textAlign: 'center',
    lineHeight: 20,
  },
});
