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

### 日历事件：独立日历 + 全量替换 + 1规则=1事件

- 在手机系统日历中创建独立日历（如"订阅管理"），不与用户个人日历混合
- 每次同步时：删除该日历下所有事件 → 按当前 ReminderRule 重新生成
- 每条规则对应一个日历事件，方便用户在日历 App 中区分提醒层级

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
