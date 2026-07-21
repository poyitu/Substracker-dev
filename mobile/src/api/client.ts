// ============================================================
// API 客户端
// 封装 fetch 调用：自动附加 Authorization header，统一错误处理
// ============================================================

import type { Subscription, ReminderRule, DashboardStats, NextReminder } from '../types';

class ApiClient {
  private baseUrl = '';
  private token: string | null = null;

  setBaseUrl(url: string) {
    this.baseUrl = url;
  }

  setToken(token: string) {
    this.token = token;
  }

  clearToken() {
    this.token = null;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    if (!this.baseUrl) {
      throw new ApiError('未设置 Worker 地址，请先登录', 0);
    }

    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(url, { ...options, headers });

    if (res.status === 401) {
      // Token 过期或无效
      throw new ApiError('认证失败，请重新登录', 401);
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(
        body.message || `请求失败 (${res.status})`,
        res.status,
      );
    }

    return res.json();
  }

  // ---- Auth ----
  login(username: string, password: string) {
    return this.request<{ success: boolean; token?: string; message?: string }>(
      '/api/login',
      { method: 'POST', body: JSON.stringify({ username, password }) },
    );
  }

  // ---- Subscriptions ----
  getSubscriptions() {
    return this.request<Subscription[]>('/api/subscriptions');
  }

  getSubscription(id: string) {
    return this.request<Subscription>(`/api/subscriptions/${id}`);
  }

  createSubscription(sub: Partial<Subscription>) {
    return this.request<Subscription>('/api/subscriptions', {
      method: 'POST',
      body: JSON.stringify(sub),
    });
  }

  updateSubscription(id: string, sub: Partial<Subscription>) {
    return this.request<Subscription>(`/api/subscriptions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(sub),
    });
  }

  deleteSubscription(id: string) {
    return this.request<{ success: boolean }>(`/api/subscriptions/${id}`, {
      method: 'DELETE',
    });
  }

  getDashboardStats() {
    return this.request<{ success: boolean; data: any }>('/api/dashboard/stats').then((res) => {
      if (!res.success || !res.data) throw new Error('获取统计数据失败');
      const d = res.data;
      return {
        total: d.activeSubscriptions?.total ?? 0,
        expiringThisMonth: d.activeSubscriptions?.expiringSoon ?? 0,
        totalMonthlyCost: d.monthlyExpense?.amount ?? 0,
        totalYearlyCost: d.yearlyExpense?.amount ?? 0,
        currencyStats: d.expenseByCategory ?? {},
        upcoming: (d.upcomingRenewals ?? []).map((r: any) => ({
          id: r.id ?? `${r.name}-${r.renewalDate}`,
          name: r.name,
          daysRemaining: r.daysUntilRenewal ?? r.daysRemaining,
          expiryDate: r.renewalDate ?? r.expiryDate,
        })),
        timezone: d.timezone,
      } as DashboardStats;
    });
  }

  // ---- Reminder Rules ----
  getReminderRules(subId: string) {
    return this.request<{ rules: ReminderRule[] }>(`/api/subscriptions/${subId}/reminders`).then((res) => res.rules);
  }

  updateReminderRules(subId: string, rules: ReminderRule[]) {
    return this.request<{ rules: ReminderRule[] }>(`/api/subscriptions/${subId}/reminders`, {
      method: 'PUT',
      body: JSON.stringify({ rules }),
    }).then((res) => res.rules);
  }

  // ---- Next Reminder ----
  getNextReminder(subId: string) {
    return this.request<NextReminder | null>(`/api/subscriptions/${subId}/next-reminder`);
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const apiClient = new ApiClient();
