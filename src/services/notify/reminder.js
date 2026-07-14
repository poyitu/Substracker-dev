import { formatTimeInTimezone, formatTimezoneDisplay } from '../../core/time.js';
import { lunarCalendar } from '../../core/lunar.js';
import { formatAmount } from '../../core/currency-format.js';

function resolveReminderSetting(subscription) {
  // 优先使用新规则系统中的单个规则（邮件展示用）
  if (subscription && subscription.reminderRule) {
    const rule = subscription.reminderRule;
    if (rule.type === 'on_expiry_at') {
      const hours = Array.isArray(rule.hours) && rule.hours.length > 0
        ? rule.hours.map(String).join(',')
        : String(rule.value || 0);
      return { unit: 'hour', value: rule.value || 0, label: `到期日 ${hours} 点` };
    } else if (rule.type === 'on_expiry') {
      return { unit: 'day', value: 0, label: '到期当天' };
    } else if (rule.type === 'after_expiry') {
      return { unit: 'hour', value: rule.value || 0, label: `到期后每 ${rule.value || 0} 小时` };
    } else {
      // before_expiry
      return {
        unit: rule.unit === 'hours' ? 'hour' : 'day',
        value: rule.value || 0,
        label: `提前 ${rule.value || 0} ${rule.unit === 'hours' ? '小时' : '天'}`
      };
    }
  }

  const defaultDays = subscription && subscription.reminderDays !== undefined ? Number(subscription.reminderDays) : 7;
  let unit = subscription && subscription.reminderUnit === 'hour' ? 'hour' : 'day';

  let value;
  if (unit === 'hour') {
    if (subscription && subscription.reminderValue !== undefined && subscription.reminderValue !== null && !isNaN(Number(subscription.reminderValue))) {
      value = Number(subscription.reminderValue);
    } else if (subscription && subscription.reminderHours !== undefined && subscription.reminderHours !== null && !isNaN(Number(subscription.reminderHours))) {
      value = Number(subscription.reminderHours);
    } else {
      value = 0;
    }
  } else {
    if (subscription && subscription.reminderValue !== undefined && subscription.reminderValue !== null && !isNaN(Number(subscription.reminderValue))) {
      value = Number(subscription.reminderValue);
    } else if (!isNaN(defaultDays)) {
      value = Number(defaultDays);
    } else {
      value = 7;
    }
  }

  if (value < 0 || isNaN(value)) {
    value = 0;
  }

  return { unit, value };
}

function shouldTriggerReminder(reminder, daysDiff, hoursDiff) {
  if (!reminder) {
    return false;
  }
  if (reminder.unit === 'hour') {
    if (reminder.value === 0) {
      return hoursDiff >= 0 && hoursDiff < 1;
    }
    return hoursDiff >= 0 && hoursDiff <= reminder.value;
  }
  if (reminder.value === 0) {
    return daysDiff === 0;
  }
  return daysDiff >= 0 && daysDiff <= reminder.value;
}

function formatNotificationContent(subscriptions, config) {
  const showLunar = config.SHOW_LUNAR === true;
  const timezone = config?.TIMEZONE || 'UTC';
  let content = '';

  for (const sub of subscriptions) {
    const typeText = sub.customType || '其他';
    const periodText = (sub.periodValue && sub.periodUnit) ? `(周期: ${sub.periodValue} ${ { day: '天', month: '月', year: '年' }[sub.periodUnit] || sub.periodUnit})` : '';
    const categoryText = sub.category ? sub.category : '未分类';
    const reminderSetting = resolveReminderSetting(sub);

    const expiryDateObj = new Date(sub.expiryDate);
    const formattedExpiryDate = formatTimeInTimezone(expiryDateObj, timezone, 'date');

    let lunarExpiryText = '';
    if (showLunar) {
      const lunarExpiry = lunarCalendar.solar2lunar(expiryDateObj.getFullYear(), expiryDateObj.getMonth() + 1, expiryDateObj.getDate());
      lunarExpiryText = lunarExpiry ? `\n农历日期: ${lunarExpiry.fullStr}` : '';
    }

    let statusText = '';
    let statusEmoji = '';
    if (sub.daysRemaining === 0) {
      statusEmoji = '⚠️';
      statusText = '今天到期！';
    } else if (sub.daysRemaining < 0) {
      statusEmoji = '🚨';
      statusText = `已过期 ${Math.abs(sub.daysRemaining)} 天`;
    } else {
      statusEmoji = '📅';
      statusText = `将在 ${sub.daysRemaining} 天后到期`;
    }

    const reminderText = reminderSetting.label
      ? `提醒策略: ${reminderSetting.label}`
      : (reminderSetting.unit === 'hour'
        ? `提醒策略: 提前 ${reminderSetting.value} 小时`
        : `提醒策略: 提前 ${reminderSetting.value} 天`);

    const calendarType = sub.useLunar ? '农历' : '公历';
    const autoRenewText = sub.autoRenew ? '是' : '否';
    const formattedAmount = formatAmount(sub.amount, sub.currency || 'CNY');
    const amountText = formattedAmount ? `\n金额: ${formattedAmount}/周期` : '';

    const subscriptionContent = `${statusEmoji} **${sub.name}**
类型: ${typeText} ${periodText}
分类: ${categoryText}${amountText}
日历类型: ${calendarType}
到期日期: ${formattedExpiryDate}${lunarExpiryText}
自动续期: ${autoRenewText}
${reminderText}
到期状态: ${statusText}`;

    let finalContent = sub.notes ? 
      subscriptionContent + `\n备注: ${sub.notes}` : 
      subscriptionContent;

    content += finalContent + '\n\n';
  }

  const currentTime = formatTimeInTimezone(new Date(), timezone, 'datetime');
  content += `发送时间: ${currentTime}\n当前时区: ${formatTimezoneDisplay(timezone)}`;

  return content;
}

export { resolveReminderSetting, shouldTriggerReminder, formatNotificationContent };
