(function (SFT) {
'use strict';

const CURRENCIES = Object.freeze(['RWF', 'USD', 'EUR', 'GBP']);
const CURRENCY_NAMES = Object.freeze({
  USD: 'US dollar',
  EUR: 'Euro',
  GBP: 'British pound',
  RWF: 'Rwandan franc'
});
const DEFAULT_BASE_CURRENCY = 'RWF';

const DEFAULT_RATES = Object.freeze({
  RWF: 1,
  USD: 0.000689655172,
  EUR: 0.000634482759,
  GBP: 0.000537931034
});

const RATE_DECIMALS = 12;
const MAX_RATE = 1e12;

const NEAR_CAP_RATIO = 0.8;
const SORT_KEYS = Object.freeze([
  'date-desc', 'date-asc', 'description-asc', 'description-desc', 'amount-desc', 'amount-asc'
]);

const MS_PER_DAY = 86_400_000;
const LOCALE = 'en-US';


function roundMoney(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function roundTo(n, decimals) {
  return Number(n.toFixed(decimals));
}

/** Plain-decimal text for a rate (never scientific notation), e.g. 0.000689655172. */
function formatRate(n) {
  return n.toFixed(RATE_DECIMALS).replace(/\.?0+$/, '');
}

function parseISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function addDays(iso, days) {
  return new Date(parseISODate(iso) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (positive when b is later). */
function daysBetween(a, b) {
  return Math.round((parseISODate(b) - parseISODate(a)) / MS_PER_DAY);
}

/** The user's LOCAL calendar date as "YYYY-MM-DD". */
function todayISO(now = new Date()) {
  const y = String(now.getFullYear()).padStart(4, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// --------------------------------------------------------------- currency

/** Convert `amount` between currencies using the documented rate convention. */
function convert(amount, from, to, rates) {
  if (from === to) return amount;
  const rateFrom = rates[from];
  const rateTo = rates[to];
  const valid = (r) => Number.isFinite(r) && r > 0;
  if (!valid(rateFrom) || !valid(rateTo)) {
    throw new RangeError(`Missing or invalid exchange rate for ${from} → ${to}.`);
  }
  return (amount / rateFrom) * rateTo;
}

function rebaseSettings(settings, newBase) {
  const { baseCurrency: oldBase, rates, cap } = settings;
  if (newBase === oldBase) return settings;
  const pivot = rates[newBase];
  const newRates = {};
  for (const code of CURRENCIES) {
    newRates[code] = code === newBase ? 1 : roundTo(rates[code] / pivot, RATE_DECIMALS);
  }
  return {
    ...settings,
    baseCurrency: newBase,
    rates: newRates,
    cap: cap === null || cap === undefined ? null : roundMoney(cap * pivot)
  };
}

function makeFormatter(currency, options = {}) {
  return new Intl.NumberFormat(LOCALE, { style: 'currency', currency, ...options });
}

/** Format money with Intl.NumberFormat; falls back to "USD 12.50" if Intl fails. */
function formatMoney(amount, currency) {
  try {
    return makeFormatter(currency).format(amount);
  } catch {
    return `${currency} ${Number(amount).toFixed(2)}`;
  }
}

/** Short form for tight spaces such as chart labels ("$1.2K"). */
function formatMoneyCompact(amount, currency) {
  try {
    return makeFormatter(currency, { notation: 'compact', maximumFractionDigits: 1 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount)}`;
  }
}

// ------------------------------------------------------------- statistics

function sumIn(transactions, displayCurrency, rates) {
  let total = 0;
  for (const t of transactions) total += convert(t.amount, t.currency, displayCurrency, rates);
  return roundMoney(total);
}

/** Per-category totals in the display currency, largest first (ties A–Z). */
function categoryBreakdown(transactions, displayCurrency, rates) {
  const totals = new Map();
  for (const t of transactions) {
    const entry = totals.get(t.category) ?? { category: t.category, total: 0, count: 0 };
    entry.total += convert(t.amount, t.currency, displayCurrency, rates);
    entry.count += 1;
    totals.set(t.category, entry);
  }
  const grand = [...totals.values()].reduce((sum, e) => sum + e.total, 0);
  return [...totals.values()]
    .map((e) => ({
      category: e.category,
      count: e.count,
      total: roundMoney(e.total),
      percent: grand > 0 ? roundTo((e.total / grand) * 100, 1) : 0
    }))
    .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));
}

function topCategory(breakdown) {
  return breakdown.length > 0 ? breakdown[0] : null;
}

/** Totals for each of the 7 calendar days ending on `today` (oldest first). */
function lastSevenDays(transactions, displayCurrency, rates, today) {
  const days = [];
  const index = new Map();
  for (let offset = -6; offset <= 0; offset += 1) {
    const entry = { date: addDays(today, offset), total: 0 };
    days.push(entry);
    index.set(entry.date, entry);
  }
  for (const t of transactions) {
    const entry = index.get(t.date);
    if (entry) entry.total += convert(t.amount, t.currency, displayCurrency, rates);
  }
  for (const entry of days) entry.total = roundMoney(entry.total);
  return {
    start: days[0].date,
    end: days[6].date,
    days,
    total: roundMoney(days.reduce((sum, d) => sum + d.total, 0))
  };
}

// ----------------------------------------------------------- spending cap

/**
 * @param {number} spent total spending (display currency)
 * @param {number|null} cap cap in the same currency, or null for "no cap"
 */
function capStatus(spent, cap) {
  if (cap === null || cap === undefined) {
    return { state: 'none', spent, cap: null, remaining: null, over: 0, percent: 0 };
  }
  const over = roundMoney(Math.max(0, spent - cap));
  const remaining = roundMoney(Math.max(0, cap - spent));
  const ratio = cap > 0 ? spent / cap : spent > 0 ? Infinity : 0;
  let state = 'within';
  if (roundMoney(spent) > roundMoney(cap)) state = 'over';
  else if (ratio >= NEAR_CAP_RATIO) state = 'near';
  return { state, spent, cap, remaining, over, percent: Math.min(100, ratio * 100) };
}

/** Cap status for the whole app state, expressed in the display currency. */
function computeCap(transactions, settings) {
  const to = settings.displayCurrency;
  const spent = sumIn(transactions, to, settings.rates);
  const cap = settings.cap === null || settings.cap === undefined
    ? null
    : roundMoney(convert(settings.cap, settings.baseCurrency, to, settings.rates));
  return capStatus(spent, cap);
}

// ---------------------------------------------------------------- sorting

/**
 * Sort a copy of `transactions`. Dates compare as timestamps, amounts as numbers
 * converted to the display currency, descriptions with a locale-aware A–Z compare.
 */
function sortTransactions(transactions, sortKey, displayCurrency, rates) {
  const [field, direction] = String(sortKey).split('-');
  const sign = direction === 'asc' ? 1 : -1;
  const valueOf = {
    date: (t) => parseISODate(t.date),
    amount: (t) => convert(t.amount, t.currency, displayCurrency, rates),
    description: (t) => t.description
  }[field];
  if (!valueOf) return [...transactions];

  return transactions
    .map((t) => ({ t, v: valueOf(t) }))
    .sort((a, b) => {
      const primary = field === 'description'
        ? a.v.localeCompare(b.v, 'en', { sensitivity: 'base', numeric: true })
        : a.v - b.v;
      if (primary !== 0) return primary * sign;
      // Deterministic tie-break that does not depend on sort direction.
      return (Date.parse(a.t.createdAt) - Date.parse(b.t.createdAt)) || a.t.id.localeCompare(b.t.id);
    })
    .map((entry) => entry.t);
}

SFT.finance = { CURRENCIES, CURRENCY_NAMES, DEFAULT_BASE_CURRENCY, DEFAULT_RATES, RATE_DECIMALS, MAX_RATE, NEAR_CAP_RATIO, SORT_KEYS, roundMoney, roundTo, formatRate, parseISODate, addDays, daysBetween, todayISO, convert, rebaseSettings, formatMoney, formatMoneyCompact, sumIn, categoryBreakdown, topCategory, lastSevenDays, capStatus, computeCap, sortTransactions };
})(window.SFT = window.SFT || {});