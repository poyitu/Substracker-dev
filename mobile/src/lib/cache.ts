// ============================================================
// 轻量本地缓存：让数据页冷启动立即显示上次结果，后台刷新
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  dashboard: 'substracker.cache.dashboard',
  subscriptions: 'substracker.cache.subscriptions',
} as const;

export type CacheKey = keyof typeof KEYS;

export async function readCache<T>(key: CacheKey): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(KEYS[key]);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: CacheKey, data: T): void {
  AsyncStorage.setItem(KEYS[key], JSON.stringify(data)).catch(() => {});
}
