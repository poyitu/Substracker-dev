// ============================================================
// 登录页 — 登录成功后由根布局条件渲染自动切换
// ============================================================

import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, StatusBar } from 'react-native';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../src/stores/auth';

function getDefaultWorkerUrl(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Constants = require('expo-constants').default ?? require('expo-constants');
    // expoConfig (SDK 47+) / manifest (旧版) / extra 走 env 兜底
    const extras = Constants?.expoConfig?.extra ?? Constants?.manifest?.extra ?? {};
    return extras?.defaultWorkerUrl ?? 'https://substracker.poyitu8.dpdns.org';
  } catch {
    return 'https://substracker.poyitu8.dpdns.org';
  }
}

export default function LoginScreen() {
  const { login } = useAuth();
  const [workerUrl, setWorkerUrl] = useState(getDefaultWorkerUrl());
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!workerUrl.trim() || !workerUrl.includes('://')) {
      Alert.alert('提示', '请输入有效的 Worker 地址');
      return;
    }
    setLoading(true);
    try {
      await login(workerUrl.trim(), username.trim(), password);
    } catch (err) {
      const message = err instanceof Error ? err.message : '请检查地址和凭据';
      Alert.alert('登录失败', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0}
    >
      <View style={styles.content}>
        <View style={styles.logoArea}>
          <Ionicons name="layers" size={48} color="#4F46E5" />
          <Text style={styles.appName}>SubsTracker</Text>
          <Text style={styles.tagline}>连接你的订阅管理中心</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Worker 地址</Text>
            <TextInput
              style={styles.input}
              value={workerUrl}
              onChangeText={setWorkerUrl}
              placeholder="https://your-worker.example.com"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>用户名</Text>
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>密码</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              onSubmitEditing={handleLogin}
            />
          </View>

          <TouchableOpacity
            style={[styles.loginButton, loading && styles.loginButtonDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.8}
          >
            <Text style={styles.loginText}>
              {loading ? '连接中...' : '连接'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  logoArea: { alignItems: 'center', marginBottom: 40 },
  appName: { fontSize: 32, fontWeight: '700', color: '#111827', marginTop: 12 },
  tagline: { fontSize: 14, color: '#6B7280', marginTop: 4 },
  form: { gap: 16 },
  inputGroup: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: '#374151' },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#FFFFFF',
  },
  loginButton: {
    marginTop: 8,
    backgroundColor: '#4F46E5',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  loginButtonDisabled: { opacity: 0.6 },
  loginText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});
