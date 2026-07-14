// @ts-check
/**
 * 调度器集成测试
 *
 * 4 个核心场景（修复 #91 / #52 / #166）：
 * 1. UTC 0点 + TZ Asia/Shanghai + NOTIFICATION_HOURS=["08"] + 北京 8 点 → 应发送
 * 2. 同上但 NOTIFICATION_HOURS=["00"] → 不发送
 * 3. 多规则订阅（7/3/1/当天）：到期前 3 天 → 仅命中 value:3
 * 4. 同规则同小时第二次调用 → 去重跳过
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// @ts-ignore
import { env } from 'cloudflare:test';

import { checkExpiringSubscriptions } from '../../src/services/scheduler.js';
import * as subRepo from '../../src/data/subscriptions.repo.js';
import * as remindersRepo from '../../src/data/reminders.repo.js';
import { getRecent } from '../../src/data/scheduler-logs.repo.js';
import { query as queryNotifyLogs } from '../../src/data/notification-logs.repo.js';

const testEnv = /** @type {import('cloudflare:test').ProvidedEnv & { SUBSCRIPTIONS_KV: import('@cloudflare/workers-types').KVNamespace }} */ (env);

async function clearKv() {
  const list = await testEnv.SUBSCRIPTIONS_KV.list();
  await Promise.all(list.keys.map((k) => testEnv.SUBSCRIPTIONS_KV.delete(k.name)));
}

/** 写入一条系统配置
 * @param {Record<string, unknown>} cfg
 */
async function setConfig(cfg) {
  await testEnv.SUBSCRIPTIONS_KV.put('config', JSON.stringify(cfg));
}

/** mock fetch 返回 Telegram 成功 */
function mockTelegramOk() {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  );
}

beforeEach(async () => {
  await clearKv();
  vi.useRealTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('调度器 - 时区 + 通知时段', () => {
  it('场景1：UTC 0点 + TZ Asia/Shanghai + NOTIFICATION_HOURS=[08] + 北京 8 点 → 发送', async () => {
    // mock 当前时间为 UTC 2026-05-24 00:00 = 北京 5/24 08:00
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-24T00:00:00.000Z'));

    await setConfig({
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'password',
      JWT_SECRET: 'secret',
      TIMEZONE: 'Asia/Shanghai',
      NOTIFICATION_HOURS: ['08'],
      ENABLED_NOTIFIERS: ['telegram'],
      TG_BOT_TOKEN: 'B',
      TG_CHAT_ID: 'C'
    });

    // 一条订阅，5 月 31 日北京时间到期，距今 7 天
    await subRepo.save(testEnv, {
      id: 's-netflix',
      name: 'Netflix',
      isActive: true,
      autoRenew: false,
      expiryDate: '2026-05-31T03:00:00.000Z', // 北京 5/31 11:00 → 距 5/24 7 天
      currency: 'CNY',
      periodValue: 1,
      periodUnit: 'month',
      reminderUnit: 'day',
      reminderValue: 7
    });
    await remindersRepo.replaceForSubscription(testEnv, 's-netflix', [
      remindersRepo.normalizeRule({ type: 'before_expiry', value: 7, unit: 'days' })
    ]);

    const fetchSpy = mockTelegramOk();
    const log = /** @type {import('../../src/data/scheduler-logs.repo.js').SchedulerLogEntry} */ (await checkExpiringSubscriptions(testEnv));
    expect(log.status).toBe('ok');
    expect(log.sentCount).toBe(1);
    expect(log.matchedCount).toBe(1);
    expect(log.dedupedCount).toBe(0);
    expect(log.timezone).toBe('Asia/Shanghai');
    expect(log.currentHour).toBe('08');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('场景2：同样设置但 NOTIFICATION_HOURS=[00] → 跳过不发送', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-24T00:00:00.000Z')); // 北京 08:00

    await setConfig({
      JWT_SECRET: 's',
      TIMEZONE: 'Asia/Shanghai',
      NOTIFICATION_HOURS: ['00'], // 用户配的是北京 0 点
      ENABLED_NOTIFIERS: ['telegram'],
      TG_BOT_TOKEN: 'B',
      TG_CHAT_ID: 'C'
    });
    await subRepo.save(testEnv, {
      id: 's-x',
      name: 'X',
      isActive: true,
      autoRenew: false,
      expiryDate: '2026-05-31T00:00:00Z',
      currency: 'CNY',
      reminderUnit: 'day',
      reminderValue: 7
    });

    const fetchSpy = mockTelegramOk();
    const log = /** @type {import('../../src/data/scheduler-logs.repo.js').SchedulerLogEntry} */ (await checkExpiringSubscriptions(testEnv));
    expect(log.status).toBe('skipped');
    expect(log.inWindow).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('场景3：多规则订阅（7/3/1/0），到期前 3 天 → 仅 value=3 命中', async () => {
    // 北京 5/24 08:00 → 到期 5/27 11:00 北京 → 距 3 天
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-24T00:00:00.000Z'));

    await setConfig({
      JWT_SECRET: 's',
      TIMEZONE: 'Asia/Shanghai',
      NOTIFICATION_HOURS: [],
      ENABLED_NOTIFIERS: ['telegram'],
      TG_BOT_TOKEN: 'B',
      TG_CHAT_ID: 'C'
    });
    await subRepo.save(testEnv, {
      id: 's-multi',
      name: 'Multi',
      isActive: true,
      autoRenew: false,
      expiryDate: '2026-05-27T03:00:00.000Z'
    });
    await remindersRepo.replaceForSubscription(testEnv, 's-multi', [
      remindersRepo.normalizeRule({ type: 'before_expiry', value: 7, unit: 'days' }),
      remindersRepo.normalizeRule({ type: 'before_expiry', value: 3, unit: 'days' }),
      remindersRepo.normalizeRule({ type: 'before_expiry', value: 1, unit: 'days' }),
      remindersRepo.normalizeRule({ type: 'on_expiry', value: 0, unit: 'days' })
    ]);

    mockTelegramOk();
    const log = /** @type {import('../../src/data/scheduler-logs.repo.js').SchedulerLogEntry} */ (await checkExpiringSubscriptions(testEnv));
    expect(log.matchedCount).toBe(1); // 只命中 value=3
    expect(log.sentCount).toBe(1);
    expect(log.extra.candidates).toHaveLength(1);
    expect(log.extra.candidates[0].ruleValue).toBe(3);
  });

  it('场景4：同规则同小时第二次调用 → 去重跳过', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-24T00:00:00.000Z'));
    await setConfig({
      JWT_SECRET: 's',
      TIMEZONE: 'Asia/Shanghai',
      NOTIFICATION_HOURS: [],
      ENABLED_NOTIFIERS: ['telegram'],
      TG_BOT_TOKEN: 'B',
      TG_CHAT_ID: 'C'
    });
    await subRepo.save(testEnv, {
      id: 's-dedupe',
      name: 'Dedupe',
      isActive: true,
      autoRenew: false,
      expiryDate: '2026-05-25T03:00:00.000Z'
    });
    await remindersRepo.replaceForSubscription(testEnv, 's-dedupe', [
      remindersRepo.normalizeRule({ type: 'before_expiry', value: 1, unit: 'days' })
    ]);

    const fetchSpy = mockTelegramOk();

    const log1 = /** @type {import('../../src/data/scheduler-logs.repo.js').SchedulerLogEntry} */ (await checkExpiringSubscriptions(testEnv));
    expect(log1.sentCount).toBe(1);
    expect(log1.dedupedCount).toBe(0);

    const log2 = /** @type {import('../../src/data/scheduler-logs.repo.js').SchedulerLogEntry} */ (await checkExpiringSubscriptions(testEnv));
    expect(log2.sentCount).toBe(0);
    expect(log2.dedupedCount).toBe(1);
    expect(log2.matchedCount).toBe(1);

    expect(fetchSpy).toHaveBeenCalledTimes(1); // 只发了一次
  });

  it('场景5：NOTIFICATION_HOURS=["*"] 通配符不应被 padStart 误处理为 "0*"', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-24T00:00:00.000Z'));
    await setConfig({
      JWT_SECRET: 's',
      TIMEZONE: 'Asia/Shanghai',
      NOTIFICATION_HOURS: ['*'],
      ENABLED_NOTIFIERS: ['telegram'],
      TG_BOT_TOKEN: 'B',
      TG_CHAT_ID: 'C'
    });
    await subRepo.save(testEnv, {
      id: 's-wc',
      name: 'WC',
      isActive: true,
      autoRenew: false,
      expiryDate: '2026-05-25T03:00:00.000Z'
    });
    await remindersRepo.replaceForSubscription(testEnv, 's-wc', [
      remindersRepo.normalizeRule({ type: 'before_expiry', value: 1, unit: 'days' })
    ]);

    mockTelegramOk();
    const log = /** @type {import('../../src/data/scheduler-logs.repo.js').SchedulerLogEntry} */ (await checkExpiringSubscriptions(testEnv));
    expect(log.inWindow).toBe(true);
    expect(log.configuredHours).toEqual(['*']);
    expect(log.sentCount).toBe(1);
  });

  it('场景6：规则自带 hours 优先于全局 NOTIFICATION_HOURS → 仍发送', async () => {
    // 北京 5/24 08:00，全局时段只配了 [20]（晚上 8 点）
    // 但规则是 on_expiry_at + hours=[8]，应该在北京 8 点触发
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-24T00:00:00.000Z'));

    await setConfig({
      JWT_SECRET: 's',
      TIMEZONE: 'Asia/Shanghai',
      NOTIFICATION_HOURS: ['20'], // 全局只允许 20 点发
      ENABLED_NOTIFIERS: ['telegram'],
      TG_BOT_TOKEN: 'B',
      TG_CHAT_ID: 'C'
    });

    // 订阅今天到期（5/24），规则是 on_expiry_at hours=[8]
    await subRepo.save(testEnv, {
      id: 's-priority',
      name: 'Priority',
      isActive: true,
      autoRenew: false,
      expiryDate: '2026-05-24T03:00:00.000Z' // 北京 5/24 11:00 → 当天
    });
    await remindersRepo.replaceForSubscription(testEnv, 's-priority', [
      remindersRepo.normalizeRule({ type: 'on_expiry_at', value: 0, unit: 'days', hours: [8] })
    ]);

    mockTelegramOk();
    const log = /** @type {import('../../src/data/scheduler-logs.repo.js').SchedulerLogEntry} */ (await checkExpiringSubscriptions(testEnv));
    // 规则有自己的 hours，不受全局 [20] 限制
    expect(log.inWindow).toBe(false); // 全局窗口仍是 false
    expect(log.sentCount).toBe(1); // 但规则优先，仍发送
    expect(log.extra.globalWindowSkippedCount).toBe(0);
  });

  it('场景7：规则无 hours + 全局时段不匹配 → 跳过', async () => {
    // 北京 5/24 08:00，全局时段 [20]
    // 规则是 before_expiry（无 hours），应该被全局时段拦截
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-24T00:00:00.000Z'));

    await setConfig({
      JWT_SECRET: 's',
      TIMEZONE: 'Asia/Shanghai',
      NOTIFICATION_HOURS: ['20'],
      ENABLED_NOTIFIERS: ['telegram'],
      TG_BOT_TOKEN: 'B',
      TG_CHAT_ID: 'C'
    });

    await subRepo.save(testEnv, {
      id: 's-fallback',
      name: 'Fallback',
      isActive: true,
      autoRenew: false,
      expiryDate: '2026-05-31T03:00:00.000Z' // 7 天后
    });
    await remindersRepo.replaceForSubscription(testEnv, 's-fallback', [
      remindersRepo.normalizeRule({ type: 'before_expiry', value: 7, unit: 'days' })
    ]);

    mockTelegramOk();
    const log = /** @type {import('../../src/data/scheduler-logs.repo.js').SchedulerLogEntry} */ (await checkExpiringSubscriptions(testEnv));
    expect(log.inWindow).toBe(false);
    expect(log.status).toBe('skipped');
    expect(log.sentCount).toBe(0);
    expect(log.extra.globalWindowSkippedCount).toBe(1);
  });
});

describe('调度器 - 自动续订', () => {
  it('已过期 + autoRenew=true → 推进到期日 + 写 auto 支付记录', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-24T00:00:00.000Z'));

    await setConfig({
      JWT_SECRET: 's',
      TIMEZONE: 'Asia/Shanghai',
      NOTIFICATION_HOURS: [],
      ENABLED_NOTIFIERS: []
    });
    await subRepo.save(testEnv, {
      id: 's-renew',
      name: 'Renew',
      isActive: true,
      autoRenew: true,
      subscriptionMode: 'cycle',
      expiryDate: '2026-04-01T00:00:00.000Z', // 已过期 ~1.5 月
      periodValue: 1,
      periodUnit: 'month',
      amount: 10,
      currency: 'CNY',
      paymentHistory: []
    });

    const log = /** @type {import('../../src/data/scheduler-logs.repo.js').SchedulerLogEntry} */ (await checkExpiringSubscriptions(testEnv));
    expect(log.autoRenewedCount).toBe(1);

    const next = await subRepo.getById(testEnv, 's-renew');
    if (!next) {
      throw new Error('Renew subscription not found');
    }
    // @ts-ignore
    expect(new Date(next.expiryDate).getTime()).toBeGreaterThan(Date.now());
    // @ts-ignore
    expect(next.paymentHistory.length).toBeGreaterThan(0);
    // @ts-ignore
    expect(next.paymentHistory[next.paymentHistory.length - 1].type).toBe('auto');
  });
});

describe('调度器 - 写入日志', () => {
  it('每次执行都写一条 sched_log', async () => {
    await setConfig({
      JWT_SECRET: 's',
      TIMEZONE: 'UTC',
      NOTIFICATION_HOURS: [],
      ENABLED_NOTIFIERS: []
    });

    await checkExpiringSubscriptions(testEnv);
    const logs = await getRecent(testEnv, 5);
    expect(logs).toHaveLength(1);
  });

  it('成功发送时写 notify_log', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-24T00:00:00.000Z'));
    await setConfig({
      JWT_SECRET: 's',
      TIMEZONE: 'Asia/Shanghai',
      NOTIFICATION_HOURS: [],
      ENABLED_NOTIFIERS: ['telegram'],
      TG_BOT_TOKEN: 'B',
      TG_CHAT_ID: 'C'
    });
    await subRepo.save(testEnv, {
      id: 's-log',
      name: 'L',
      isActive: true,
      autoRenew: false,
      expiryDate: '2026-05-25T03:00:00.000Z'
    });
    await remindersRepo.replaceForSubscription(testEnv, 's-log', [
      remindersRepo.normalizeRule({ type: 'before_expiry', value: 1, unit: 'days' })
    ]);

    mockTelegramOk();
    await checkExpiringSubscriptions(testEnv);

    const notifyLogs = await queryNotifyLogs(testEnv, { subId: 's-log' });
    expect(notifyLogs).toHaveLength(1);
    expect(notifyLogs[0].channel).toBe('telegram');
    expect(notifyLogs[0].status).toBe('success');
  });
});
