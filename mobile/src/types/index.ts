// ============================================================
// SubsTracker 移动端类型定义
// 与 Worker API 数据模型保持一致（参考 CONTEXT.md）
// ============================================================

/** 订阅实体 */
export interface Subscription {
  id: string;
  name: string;
  isActive: boolean;
  autoRenew: boolean;
  subscriptionMode?: 'cycle' | 'reset' | 'no_renew';
  expiryDate: string; // ISO 8601
  startDate?: string;
  periodValue?: number;
  periodUnit?: 'day' | 'month' | 'year';
  amount?: number;
  currency?: string;
  category?: string;
  customType?: string;
  notes?: string;
  /** 旧版提醒字段（兼容保留） */
  reminderUnit?: 'day' | 'hour';
  reminderValue?: number;
  reminderDays?: number;
  reminderHours?: number;
  /** 提醒规则（v3 结构化规则） */
  reminderRules?: ReminderRule[];
  /** 支付记录 */
  paymentHistory?: PaymentRecord[];
  lastPaymentDate?: string;
  /** 自定义邮件配置 */
  emailFrom?: string;
  emailTo?: string;
}

/** 提醒规则 */
export interface ReminderRule {
  id: string;
  type: 'before_expiry' | 'on_expiry' | 'on_expiry_at' | 'after_expiry';
  value: number;
  unit: 'days' | 'hours';
  hours?: number[];   // on_expiry_at 专用
  repeatInterval?: number | null;
  repeatUntil?: 'renewed' | 'acknowledged' | 'never';
  isEnabled: boolean;
}

/** 支付记录 */
export interface PaymentRecord {
  type: 'auto' | 'manual';
  amount: number;
  date: string;
}

/** 仪表盘统计 */
export interface DashboardStats {
  total: number;
  active: number;
  expiringThisMonth: number;
  totalMonthlyCost: number;
  totalYearlyCost: number;
  currencyStats: Record<string, number>;
  upcoming: Array<{ id: string; name: string; daysRemaining: number; expiryDate: string }>;
  timezone?: string;
}

/** API 回应通用结构 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
}

/** 登录回应 */
export interface LoginResponse {
  success: boolean;
  token?: string;
  message?: string;
}

/** 下一页触发时间 */
export interface NextReminder {
  ruleId: string;
  nextFireAt: string; // ISO
  type: string;
  daysRemaining: number;
}
