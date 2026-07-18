// ============================================================
// 认证状态管理
// Token 存储于 expo-secure-store，状态通过 React Context 分发
// ============================================================

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import { apiClient } from '../api/client';

const TOKEN_KEY = 'auth_token';
const WORKER_URL_KEY = 'worker_url';

interface AuthState {
  token: string | null;
  workerUrl: string | null;
  isLoading: boolean;
  isLoggedIn: boolean;
}

interface AuthContextValue extends AuthState {
  login: (workerUrl: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setWorkerUrl: (url: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [workerUrl, setWorkerUrlState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 启动时恢复 token 和 workerUrl
  useEffect(() => {
    (async () => {
      try {
        // web 平台优先使用 localStorage
        let savedToken = typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
        let savedUrl = typeof localStorage !== 'undefined' ? localStorage.getItem(WORKER_URL_KEY) : null;

        // 原生平台 SecureStore
        if (!savedToken || !savedUrl) {
          const [token, url] = await Promise.all([
            SecureStore.getItemAsync(TOKEN_KEY),
            SecureStore.getItemAsync(WORKER_URL_KEY),
          ]);
          savedToken = savedToken || token;
          savedUrl = savedUrl || url;
        }

        if (savedToken) setToken(savedToken);
        if (savedUrl) {
          setWorkerUrlState(savedUrl);
          apiClient.setBaseUrl(savedUrl);
        }
        if (savedToken && savedUrl) {
          apiClient.setToken(savedToken);
        }
      } catch {
        // SecureStore 不可用时静默失败
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (url: string, username: string, password: string) => {
    const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url;

    apiClient.setBaseUrl(normalizedUrl);
    const res = await fetch(`${normalizedUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (!data.success || !data.token) {
      throw new Error(data.message || '登录失败');
    }

    // Web 平台直接用 localStorage；原生平台额外写 SecureStore
    const isWeb = typeof window !== 'undefined';
    if (isWeb && typeof localStorage !== 'undefined') {
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(WORKER_URL_KEY, normalizedUrl);
    }

    try {
      await SecureStore.setItemAsync(TOKEN_KEY, data.token);
      await SecureStore.setItemAsync(WORKER_URL_KEY, normalizedUrl);
    } catch {
      // Web 平台 SecureStore 不可用，静默降级
    }

    apiClient.setToken(data.token);
    setToken(data.token);
    setWorkerUrlState(normalizedUrl);
  }, []);

  const logout = useCallback(async () => {
    setToken(null);
    setWorkerUrlState(null);
    apiClient.clearToken();
    apiClient.setBaseUrl('');

    try {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      await SecureStore.deleteItemAsync(WORKER_URL_KEY);
    } catch {
      // web 等平台 SecureStore 不可用时静默处理
    }

    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(WORKER_URL_KEY);
    }
  }, []);

  const setWorkerUrl = useCallback(async (url: string) => {
    const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url;
    await SecureStore.setItemAsync(WORKER_URL_KEY, normalizedUrl);
    apiClient.setBaseUrl(normalizedUrl);
    setWorkerUrlState(normalizedUrl);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        token,
        workerUrl,
        isLoading,
        isLoggedIn: !!token,
        login,
        logout,
        setWorkerUrl,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
