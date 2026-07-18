// ============================================================
// 货币格式化（从 Worker 端 src/core/currency-format.js 移植）
// ============================================================

export const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: '¥',
  USD: '$',
  HKD: 'HK$',
  TWD: 'NT$',
  JPY: 'JP¥',
  EUR: '€',
  GBP: '£',
  KRW: '₩',
  TRY: '₺',
};

export function getCurrencySymbol(currency = 'CNY'): string {
  const code = String(currency || 'CNY').toUpperCase();
  return CURRENCY_SYMBOLS[code] || code + ' ';
}

export function formatAmount(
  amount: number | string | null | undefined,
  currency = 'CNY',
  opts: { withDecimal?: boolean } = {},
): string {
  if (amount === null || amount === undefined || amount === '') return '';
  const n = Number(amount);
  if (Number.isNaN(n)) return '';
  const sym = getCurrencySymbol(currency);
  const fixed = opts.withDecimal === false ? String(Math.round(n)) : n.toFixed(2);
  return sym + fixed;
}
