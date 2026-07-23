# ADR 0001: 移动端 App 架构选型

**日期**: 2026-07-17
**状态**: 已采纳
**决策者**: tuyibo

---

## 背景

SubsTracker 现有 Web 管理后台（Cloudflare Workers + 静态 HTML），需要开发配套移动端 App，核心目标是：

1. 优化订阅添加与管理流程（适配单手操作）
2. 调用手机系统日历实现本地到期提醒（App 不驻后台也能提醒）
3. 与现有 Worker API 无缝对接

## 决策

### 框架：React Native (Expo)

**考量因素：**

- **代码复用**：现有 `src/core/time.js`（时区）、`lunar.js`（农历）、`currency-format.js`（货币）是纯逻辑模块，可直接在 RN 中复用，无需 Dart/Swift/Kotlin 重写
- **日历集成**：`expo-calendar` 提供跨 iOS/Android 统一的日历 API，满足核心需求（独立日历 + 全量替换）
- **开发效率**：一套 JS/TS 代码覆盖双平台
- **否决 PWA**：PWA 无法访问 `EventKit`/`CalendarContract` 原生 API，无法创建系统日历事件

### 数据同步：纯在线 + AsyncStorage 缓存

- 单用户私有部署，无多用户并发编辑冲突
- 写操作（添加/修改/删除）实时提交 API
- AsyncStorage 缓存订阅列表，加速冷启动首屏
- 不引入本地数据库和同步引擎

### 日历事件：独立日历 + 全量替换 + 1规则=1事件 + 按开关过滤

- 在手机系统日历中创建独立日历（如"订阅管理"），不与用户个人日历混合
- `syncToCalendar` 字段控制单个订阅是否参与同步（默认 false，用户在订阅列表中手动开启）
- 每次同步时：删除该日历下所有事件 → 仅对开启了 `syncToCalendar` 的订阅按 ReminderRule 重新生成
- 每条规则对应一个日历事件，方便用户在日历 App 中区分提醒层级
- 全局闹钟设置：用户可配置事件开始前 N 分钟触发系统提醒

### 认证：JWT Bearer Token

- `POST /api/login` 响应体增加 `token` 字段（现仅 Set-Cookie）
- `getUserFromRequest` 增加 `Authorization: Bearer <token>` header 优先读取
- App 端 token 存储于 `expo-secure-store`

## 页面导航

底部 4 Tab + 浮动按钮：

```
🏠 首页仪表盘 | 📋 订阅列表 | 📅 日历同步 | ⚙️ 设置
                                    ➕ (FAB)
```

## V1 范围

| 模块 | 内容 |
|------|------|
| 首页 | 今日到期/本月到期/总订阅/月花费 |
| 订阅列表 | 分类筛选 + 搜索 + 滑动编辑/删除 |
| 添加编辑 | 完整表单 + 简化版 ReminderRule 编辑器 |
| 日历同步 | 一键同步到手机系统日历；独立日历 ID 持久化 |
| 设置 | Worker 地址配置、登出 |

延迟到 V2：通知历史、支付记录详情、OCR 快捷添加。

## API 改动

| 文件 | 改动 | 行数 |
|------|------|------|
| `src/api/handlers/auth.js:login` | 响应体加 `token` 字段 | +1 |
| `src/api/handlers/auth.js:getUserFromRequest` | 支持 `Authorization: Bearer` | +3 |

其余 14 个接口复用，不做改动。

## 后果

- **正面**：一套 JS 代码复用核心逻辑；日历事件提供可靠的离线提醒通道；双平台一劳永逸
- **负面**：Expo 依赖；`expo-calendar` 在 Android 上需要额外权限（`READ_CALENDAR`/`WRITE_CALENDAR`）
- **风险**：若未来需要蓝牙/NFC 等深层原生能力，可能需 eject 到裸 RN

## 备选方案

| 方案 | 否决原因 |
|------|----------|
| Flutter | 需 Dart 重写全部核心逻辑（time.js/lunar.js/currency-format.js），成本翻倍 |
| 原生 Swift + Kotlin | 两套代码维护，单人项目不可持续 |
| PWA | 无法访问系统日历 API，不满足核心需求 |

## 实现详情

### 目录结构

```
mobile/
├── app/                          # expo-router 文件路由
│   ├── _layout.tsx               # 根布局，控制登录态跳转
│   ├── (tabs)/                   # 底部 Tab 导航
│   │   ├── _layout.tsx           # Tab 配置
│   │   ├── index.tsx             # 首页仪表盘
│   │   ├── subscriptions.tsx     # 订阅列表
│   │   ├── calendar.tsx          # 日历同步
│   │   └── settings.tsx          # 设置
│   ├── login.tsx                 # 登录页
│   ├── add.tsx                   # 添加订阅 (Modal)
│   └── edit/[id].tsx             # 编辑订阅 (Modal)
├── src/
│   ├── api/client.ts             # API 客户端 (JWT + 错误处理)
│   ├── components/               # 通用 UI 组件
│   ├── lib/time.ts               # 时区逻辑 (移植自 src/core/time.js)
│   └── types/index.ts            # TypeScript 类型定义
└── android/                      # Android 原生配置
```

### 状态管理

无第三方状态库，使用 React `useState` + `useCallback` + Custom Hook 模式：

- **认证状态**：`src/stores/auth.tsx` — `createContext` + `useAuth()` hook，管理 `token` / `workerUrl` / `isLoggedIn`
- **订阅列表**：`useFocusEffect` 做缓存优先加载（先读 AsyncStorage 立即展示 → 后台 API 刷新）
- **添加/编辑**：局部 state，退出即销毁

### 登录流程

```
App 启动 → _layout.tsx 检查 isLoggedIn
  → false → <LoginScreen />
  → true  → <TabNavigator />
```

`login.tsx` 输入 Worker URL + 用户名 + 密码 → `POST /api/login` → 后端返回 `{ token }` → `expo-secure-store` 持久化。

### "即将到期" 判断

三层实现，已统一为 7 天窗口：

| 层 | 位置 | 函数 | 判断逻辑 |
|---|---|---|---|
| 移动端首页列表 | `mobile/src/lib/time.ts` | `isUpcomingSubscription` | 提醒规则 value → 若 value=0 回退 7 天 |
| Web 仪表盘 | `src/core/currency.js` | `getUpcomingRenewals` | 固定 7 天窗口 |
| Web 管理页 | `src/views/adminPage.html` | `getReminderSettings` | 同上，已修复 |

### 键盘避让策略

| 页面 | Android | iOS | 说明 |
|---|---|---|---|
| `login.tsx` | `KeyboardAvoidingView behavior="padding"` | 同左 | 无 ScrollView，靠 padding 避让 |
| `add.tsx` | `KeyboardAvoidingView behavior="height"` | `behavior="padding"` | 有 ScrollView，height 模式让容器缩小触发滚动 |
| `edit/[id].tsx` | 同上 | 同上 | 与 add 一致 |

`keyboardVerticalOffset` 在 Android 上用 `StatusBar.currentHeight` 适配状态栏高度。

### API 客户端设计

`mobile/src/api/client.ts` — 单例 `apiClient`：

- `request<T>(path, options)` — 核心方法
- 自动附加 `Authorization: Bearer <token>`
- 401 → `ApiError('认证失败', 401)` → `auth.tsx` 消费并登出
- `Error('请先登录并配置 Worker 地址')` — `baseUrl` 为空时守卫

### Header 避让状态栏

`add.tsx` / `edit/[id].tsx` header 使用 `StatusBar.currentHeight` 替代硬编码：
```ts
paddingTop: Platform.OS === 'ios' ? 60 : (StatusBar.currentHeight || 24) + 12
```

### 提醒规则数据模型

```ts
interface ReminderRule {
  id: string;
  type: 'before_expiry' | 'on_expiry' | 'on_expiry_at';
  value: number;       // 天数或小时数
  unit: 'days' | 'hours';
  hours?: number[];    // on_expiry_at: 指定小时列表 [9, 18]
  isEnabled: boolean;
  repeatInterval?: number | null;
  repeatUntil?: string;
  createdAt?: string;
}
```

后端 `GET /api/subscriptions/:id` 已自动拼入 `reminderRules`，移动端无需二次请求。

### 已发现并修复的 Bug

| Bug | 根因 | 修复 | 影响文件 |
|---|---|---|---|
| `on_expiry`/`on_expiry_at` 规则不显示"即将到期" | `value=0` 导致 `daysDiff <= 0` 只在到期当天匹配 | 同一 bug 修了三份（移动端 + Web 管理页 + `isUpcomingSubscription`） | `time.ts`, `adminPage.html` |
| 编辑页加载慢 | 两次串行 API 请求（`getSubscription` + `getReminderRules`），后者冗余 | 删冗余请求，直接用响应中的 `sub.reminderRules` | `edit/[id].tsx` |
| Android header/键盘遮挡 | `paddingTop` 硬编码 16；`KeyboardAvoidingView` 用了无效 behavior | `StatusBar.currentHeight` + `behavior="height"` | `add.tsx`, `login.tsx`, `edit/[id].tsx` |
