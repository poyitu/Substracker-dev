# SubsTracker 领域词汇表

本文档定义项目中使用的核心术语，确保所有上下文（Web 管理后台、Worker API、移动端 App）使用一致的语言。

---

## 核心实体

### Subscription（订阅）

用户追踪的一项周期性付费服务。包含以下关键属性：

- **id**: 唯一标识符（用户自定义，如 `s-netflix`）
- **name**: 服务名称
- **isActive**: 是否活跃（停用的订阅不参与提醒）
- **autoRenew**: 是否自动续订（续订时自动推进到期日并写支付记录）
- **subscriptionMode**: 续订模式 — `cycle`（周期接续）或 `reset`（以支付日重置）
- **expiryDate**: 到期日期（ISO 8601）
- **periodValue / periodUnit**: 计费周期（如 1 month）
- **amount / currency**: 金额与币种
- **reminderUnit / reminderValue**: 旧版提醒字段（v3 起被 ReminderRule 替代，仅作兼容保留）

### ReminderRule（提醒规则）

一条独立的提醒触发条件。每条 Subscription 可绑定多条规则。

- **type**: `before_expiry` | `on_expiry` | `on_expiry_at` | `after_expiry`
- **value**: 数值（如 7 表示提前 7 天）
- **unit**: `days` | `hours`
- **hours**: `on_expiry_at` 专用，指定到期日触发的小时 (0–23)
- **repeatInterval**: `after_expiry` 专用，到期后重复间隔（小时）
- **repeatUntil**: `renewed` | `acknowledged` | `never`
- **isEnabled**: 是否启用

### PaymentRecord（支付记录）

Subscription 续费或手动支付时生成的一条记录。包含 `type`（`auto`/`manual`）、`amount`、`date`。

### SchedulerLog（调度日志）

Worker Cron 每次执行产生的聚合日志。记录命中规则数、发送数、去重跳过数、自动续订数等。

### NotificationLog（通知日志）

每条通知发送的细粒度日志。按 `(subId, ruleId, channel)` 维度存储，包含发送状态（success/failure）、错误信息。

### CalendarEvent（日历事件）

移动端 App 按 ReminderRule 在手机系统日历中创建的提醒事件。归属于一个独立的设备日历（如"订阅管理"），与用户个人日历隔离。

---

## 关键概念

### 通知时段（Notification Window）

配置项 `NOTIFICATION_HOURS` 定义允许发送通知的小时窗口（按用户时区解释）。值为 `["*"]` 表示全时段。规则自带 `hours` 配置时优先于全局时段。

### 去重（Deduplication）

调度器每次执行时，通过 KV key `notify_dedupe:{subId}:{ruleId}:{ymdhLocal}` 避免同一小时重复发送同一规则的提醒。TTL 为 48 小时。

### 自动续订（Auto-Renewal）

`autoRenew=true` 且已过期的订阅，调度器会自动：推进到期日、生成一条 `type=auto` 的支付记录。

### 日历同步（Calendar Sync）

移动端 App 将 Subscription 的 ReminderRule 转化为手机系统日历事件的过程。策略为：独立日历 + 全量替换（删除该日历下所有事件后重新写入）。

---

## 架构边界

| 层 | 职责 |
|----|------|
| Worker API | 数据持久化（KV）、认证、Cron 调度、通知发送 |
| Web 管理后台 | 完整的订阅管理 UI（SPA 静态页面） |
| 移动端 App | 快捷查看/添加订阅、日历同步、本地提醒 |

Worker API 是唯一的真相源（source of truth）。移动端 App 不维护独立的数据库，仅做 AsyncStorage 缓存加速首屏加载。
