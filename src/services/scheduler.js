// 注：本文件暂不启用 // @ts-check，因 lunar 库返回类型分支较多，类型清理推迟到后续 Task。
/**
 * 定时任务调度器
 *
 * ── 修复的核心问题（#91 / #52 / #166 根因）─────────────────
 * 旧调度器把"当前 UTC 时刻的小时"当作"用户本地小时"来对比 NOTIFICATION_HOURS，
 * 配合"通知时段语义不一致"的文档表述，造成大量"不响 / 错时响"。
 *
 * 修复：
 * 1. 统一时区基准：通过 getNowInTimezone(config.TIMEZONE) 取用户 TZ 下的 hourString
 *    与 NOTIFICATION_HOURS（按用户 TZ 解释）比对，语义清晰。
 * 2. 多提醒规则：从 reminders.repo 加载每个订阅的规则数组，逐条调
 *    reminder-engine.shouldFire 判断（不再单点 reminderUnit/reminderValue）。
 * 3. 去重粒度细化：dedup key 改为 (subId × ruleId × ymdh-local)，避免一条订阅
 *    多规则相互打架。
 * 4. 结构化日志：每次执行写一条 sched_log；每条通知发送（成功/失败）写 notify_log。
 *
 * 数据流：
 *   Cron tick →
 *     ensureMigrations →
 *     load config + subs + rules →
 *     check window →
 *     for each (sub, rule):
 *       - daysDiff/hoursDiff 用 getDaysBetween（按用户 TZ）算
 *       - 自动续订（针对 sub 整体，仅算一次）
 *       - shouldFire? → dedupe → dispatch.send → notify_log
 *     → sched_log
 *
 */

import { getConfig } from '../data/config.js';
import { getAllSubscriptions } from '../data/subscriptions.js';
import * as subRepo from '../data/subscriptions.repo.js';
import * as remindersRepo from '../data/reminders.repo.js';
import * as schedulerLogsRepo from '../data/scheduler-logs.repo.js';
import {
  MS_PER_HOUR,
  getNowInTimezone,
  getDaysBetween
} from '../core/time.js';
import { formatNotificationContent } from './notify/reminder.js';
import { dispatch } from './notify/dispatch.js';
import { shouldFire } from './notify/reminder-engine.js';
import { lunarCalendar, lunarBiz } from '../core/lunar.js';

const DEDUPE_TTL_SEC = 60 * 60 * 48; // 48h

/**
 * 入口：被 Cron 触发的 scheduled() 调用。
 *
 * @param {{ SUBSCRIPTIONS_KV: KVNamespace }} env
 * @returns {Promise<import('../data/scheduler-logs.repo.js').SchedulerLogEntry|null>}
 */
export async function checkExpiringSubscriptions(env) {
  const startedAtIso = new Date().toISOString();
  try {
    const config = await getConfig(env);
    const timezone = config.TIMEZONE || 'UTC';
    const now = getNowInTimezone(timezone);

    const normalizedHours = Array.isArray(config.NOTIFICATION_HOURS)
      ? config.NOTIFICATION_HOURS
          .map((h) => String(h).trim())
          .filter((h) => h.length > 0)
          .map((h) => {
            const up = h.toUpperCase();
            if (up === '*' || up === 'ALL') return '*';
            // 仅对纯数字做两位补齐；'*' 之类通配符保持原样
            return /^\d+$/.test(h) ? h.padStart(2, '0') : up;
          })
      : [];
    const inWindow =
      normalizedHours.length === 0 ||
      normalizedHours.includes('*') ||
      normalizedHours.includes('ALL') ||
      normalizedHours.includes(now.hourString);

    const subscriptions = await getAllSubscriptions(env);
    let activeCount = 0;
    let matchedCount = 0;
    let dedupedCount = 0;
    let sentCount = 0;
    let autoRenewedCount = 0;

    // 不在通知时段：不发送但仍跑自动续订（业务上希望续订总能发生）
    /** @type {Array<{ sub: any, rule: any, daysDiff: number, hoursDiff: number }>} */
    const candidates = [];

    /** @type {Array<any>} */
    const updatedSubsToSave = [];

    for (const subscription of subscriptions) {
      if (!subscription.isActive) continue;
      activeCount++;

      // 计算到期天数（按用户 TZ）
      let expiryDate = new Date(subscription.expiryDate);
      let daysDiff = getDaysBetween(now.utc, expiryDate, timezone);
      let hoursDiff = (expiryDate.getTime() - now.utc.getTime()) / MS_PER_HOUR;

      // 一次性订阅（no_renew）：到期后完全静默，不续订也不提醒
      if (subscription.subscriptionMode === 'no_renew' && daysDiff < 0) {
        continue;
      }

      if (subscription.autoRenew && daysDiff < 0) {
        const renewed = autoRenew(subscription, now.utc, timezone, config);
        if (renewed) {
          updatedSubsToSave.push(renewed.next);
          autoRenewedCount++;
          expiryDate = new Date(renewed.next.expiryDate);
          daysDiff = getDaysBetween(now.utc, expiryDate, timezone);
          hoursDiff = (expiryDate.getTime() - now.utc.getTime()) / MS_PER_HOUR;
          subscription.expiryDate = renewed.next.expiryDate;
          subscription.startDate = renewed.next.startDate;
          subscription.lastPaymentDate = renewed.next.lastPaymentDate;
          subscription.paymentHistory = renewed.next.paymentHistory;
        }
      }

      // 加载规则；老订阅没有规则时，用 legacyFieldToRule 现场转一条
      let rules = await remindersRepo.listForSubscription(env, subscription.id);
      if (rules.length === 0) {
        rules = [remindersRepo.legacyFieldToRule(subscription)];
      }

      for (const rule of rules) {
        const decision = shouldFire(rule, { daysDiff, hoursDiff, nowIso: now.utc.toISOString(), currentHour: now.parts.hour });
        if (!decision.fire) continue;
        matchedCount++;
        candidates.push({ sub: subscription, rule, daysDiff, hoursDiff });
      }
    }

    // 持久化自动续订结果
    if (updatedSubsToSave.length > 0) {
      await subRepo.saveMany(env, updatedSubsToSave);
      console.log(`[定时任务] 已自动续订 ${updatedSubsToSave.length} 个订阅`);
    }

    // 在时段（或规则自带 hours）：去重 + 发送
    /** @type {Array<{ sub: any, rule: any, daysDiff: number, hoursDiff: number }>} */
    const ready = [];
    const ymdhLocal = `${now.parts.year}${String(now.parts.month).padStart(2, '0')}${String(
      now.parts.day
    ).padStart(2, '0')}${now.hourString}`;
    let globalWindowSkippedCount = 0;
    for (const c of candidates) {
      // 规则优先：规则有自己的 hours 配置时，不应用全局时段
      const ruleHasHours = Array.isArray(c.rule.hours) && c.rule.hours.length > 0;
      if (!ruleHasHours && !inWindow) {
        globalWindowSkippedCount++;
        continue;
      }
      const dedupeKey = `notify_dedupe:${c.sub.id}:${c.rule.id}:${ymdhLocal}`;
      const exists = await env.SUBSCRIPTIONS_KV.get(dedupeKey);
      if (exists) {
        dedupedCount++;
        continue;
      }
      await env.SUBSCRIPTIONS_KV.put(dedupeKey, '1', { expirationTtl: DEDUPE_TTL_SEC });
      ready.push(c);
    }

    if (ready.length === 0) {
      const entry = await schedulerLogsRepo.writeLog(env, {
        startedAt: startedAtIso,
        finishedAt: new Date().toISOString(),
        timezone,
        currentHour: now.hourString,
        configuredHours: normalizedHours,
        inWindow,
        checkedCount: activeCount,
        matchedCount,
        dedupedCount,
        sentCount: 0,
        autoRenewedCount,
        status: matchedCount > 0 ? 'skipped' : 'ok',
        reason:
          matchedCount > 0
            ? `命中 ${matchedCount} 条规则：去重跳过 ${dedupedCount}，全局时段跳过 ${globalWindowSkippedCount}`
            : '本次未命中任何提醒规则',
        extra: { globalWindowSkippedCount }
      });
      return entry;
    }

    // 排序：按剩余天数升序，更紧迫的在前
    ready.sort((a, b) => a.daysDiff - b.daysDiff);

    // 是否有规则 hours 优先发送（全局窗口 false 但仍有通知发出）
    const ruleHoursPriorityUsed = ready.some(
      (c) => Array.isArray(c.rule.hours) && c.rule.hours.length > 0 && !inWindow
    );

    // 一次性聚合所有订阅成一条通知（与既有渠道契约一致）
    // notify_log 按 (subId, ruleId, channel) 维度落，仍可细粒度查询
    const enrichedSubs = ready.map((c) => ({
      ...c.sub,
      daysRemaining: c.daysDiff,
      hoursRemaining: Math.round(c.hoursDiff),
      reminderRule: c.rule
    }));
    const content = formatNotificationContent(enrichedSubs, config);
    const title = '订阅到期/续费提醒';

    // 若到期订阅中有自定义发件人/收件人邮箱，则覆盖全局对应配置
    const subWithCustomSender = ready.find((c) => c.sub.emailFrom || c.sub.emailTo);
    const dispatchConfig = subWithCustomSender
      ? {
          ...config,
          EMAIL_FROM: subWithCustomSender.sub.emailFrom || config.EMAIL_FROM,
          EMAIL_TO: subWithCustomSender.sub.emailTo || config.EMAIL_TO
        }
      : config;

    // 给 dispatch 提供主 subId+ruleId（聚合通知用第一条做归属）
    const primary = ready[0];
    const dispatchResult = await dispatch(
      { title, content },
      dispatchConfig,
      {
        env,
        subId: primary.sub.id,
        ruleId: primary.rule.id,
        logPrefix: '[定时任务]',
        metadata: {
          tags: enrichedSubs.map((s) => s.name),
          daysRemaining: primary.daysDiff,
          ruleType: primary.rule.type,
          ruleValue: primary.rule.value
        }
      }
    );
    sentCount = dispatchResult.successCount;

    const entry = await schedulerLogsRepo.writeLog(env, {
      startedAt: startedAtIso,
      finishedAt: new Date().toISOString(),
      timezone,
      currentHour: now.hourString,
      configuredHours: normalizedHours,
      inWindow,
      checkedCount: activeCount,
      matchedCount,
      dedupedCount,
      sentCount,
      autoRenewedCount,
      status: dispatchResult.failedCount > 0 && sentCount === 0 ? 'error' : 'ok',
      reason:
        dispatchResult.attempted > 0
          ? `发送到 ${dispatchResult.attempted} 个渠道，成功 ${dispatchResult.successCount} / 失败 ${dispatchResult.failedCount}` +
            (ruleHoursPriorityUsed ? '（规则 hours 优先，全局窗口 false）' : '')
          : '未启用任何通知渠道',
      extra: {
        candidates: ready.map((c) => ({
          subId: c.sub.id,
          subName: c.sub.name,
          ruleId: c.rule.id,
          ruleType: c.rule.type,
          ruleValue: c.rule.value,
          daysDiff: c.daysDiff
        })),
        channelResults: dispatchResult.channelResults,
        globalWindowSkippedCount,
        ruleHoursPriorityUsed
      }
    });
    return entry;
  } catch (error) {
    console.error('[定时任务] 执行失败:', error);
    return schedulerLogsRepo.writeLog(env, {
      startedAt: startedAtIso,
      finishedAt: new Date().toISOString(),
      timezone: 'UTC',
      currentHour: '00',
      configuredHours: [],
      inWindow: false,
      checkedCount: 0,
      matchedCount: 0,
      dedupedCount: 0,
      sentCount: 0,
      autoRenewedCount: 0,
      status: 'error',
      reason: '执行异常: ' + (error && error.message ? error.message : String(error)),
      extra: { stack: error && error.stack }
    });
  }
}

/**
 * 自动续订：把已过期的订阅按周期推进，生成 auto 类型支付记录。
 *
 * 按"cycle / reset 模式 + 公历 / 农历分支。
 *
 * @param {any} sub
 * @param {Date} now UTC 时刻
 * @param {string} timezone
 * @param {any} config
 * @returns {{ next: any } | null}
 */
function autoRenew(sub, now, timezone, config) {
  const mode = sub.subscriptionMode || 'cycle';
  let expiryDate = new Date(sub.expiryDate);
  let periodsAdded = 0;

  if (sub.useLunar) {
    let lunar = lunarCalendar.solar2lunar(
      expiryDate.getFullYear(),
      expiryDate.getMonth() + 1,
      expiryDate.getDate()
    );
    while (expiryDate <= now) {
      lunar = lunarBiz.addLunarPeriod(lunar, sub.periodValue, sub.periodUnit);
      const solar = lunarBiz.lunar2solar(lunar);
      expiryDate = new Date(solar.year, solar.month - 1, solar.day);
      periodsAdded++;
      if (periodsAdded > 60) break; // 防御
    }
  } else {
    while (expiryDate <= now) {
      if (mode === 'reset') expiryDate = new Date(now);
      if (sub.periodUnit === 'day') expiryDate.setDate(expiryDate.getDate() + sub.periodValue);
      else if (sub.periodUnit === 'month') expiryDate.setMonth(expiryDate.getMonth() + sub.periodValue);
      else if (sub.periodUnit === 'year') expiryDate.setFullYear(expiryDate.getFullYear() + sub.periodValue);
      periodsAdded++;
      if (periodsAdded > 120) break;
    }
  }

  if (periodsAdded === 0) return null;

  const newStartDate = mode === 'reset' ? new Date(now) : new Date(sub.expiryDate);
  const newExpiryDate = expiryDate;
  void timezone;

  const paymentRecord = {
    id: Date.now().toString(),
    date: now.toISOString(),
    amount: sub.amount || 0,
    type: 'auto',
    note: `自动续订 (${mode === 'reset' ? '重置模式' : '接续模式'}${
      periodsAdded > 1 ? ', 补齐' + periodsAdded + '周期' : ''
    })`,
    periodStart: newStartDate.toISOString(),
    periodEnd: newExpiryDate.toISOString()
  };

  const paymentHistoryLimit = Number(config.PAYMENT_HISTORY_LIMIT) || 100;
  const ph = [...(sub.paymentHistory || []), paymentRecord];
  const trimmed = ph.length > paymentHistoryLimit ? ph.slice(-paymentHistoryLimit) : ph;

  return {
    next: {
      ...sub,
      startDate: newStartDate.toISOString(),
      expiryDate: newExpiryDate.toISOString(),
      lastPaymentDate: now.toISOString(),
      paymentHistory: trimmed
    }
  };
}
