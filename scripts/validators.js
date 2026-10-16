(function (SFT) {
'use strict';
const { CURRENCIES, DEFAULT_BASE_CURRENCY, DEFAULT_RATES, MAX_RATE, roundTo, RATE_DECIMALS } = SFT.finance;

const APP_ID = 'student-finance-tracker';
const SCHEMA_VERSION = 1;

const MAX_DESCRIPTION = 100;
const MAX_CATEGORY = 30;
const MAX_CATEGORIES = 50;
const MAX_TRANSACTIONS = 10_000;
const MAX_AMOUNT = 1_000_000_000;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

const PATTERNS = Object.freeze({
  description: /^\S(?:.*\S)?$/,
  amount: /^(0|[1-9]\d*)(\.\d{1,2})?$/,
  date: /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
  displayDate: /^(0[1-9]|[12]\d|3[01])-(0[1-9]|1[0-2])-(\d{4})$/,
  category: /^[A-Za-z]+(?:[ -][A-Za-z]+)*$/,
  duplicateWord: /\b(\w+)\s+\1\b/i,
  timestamp: /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/,
  recordId: /^[A-Za-z0-9_-]{1,40}$/,
  rate: /^\d+(\.\d{1,12})?$/
});

const ok = (value, extra = {}) => ({ ok: true, value, ...extra });
const fail = (error) => ({ ok: false, error });
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function normalizeDescription(raw) {
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

function findDuplicateWord(text) {
  const match = PATTERNS.duplicateWord.exec(text);
  return match ? match[1] : null;
}

function validateDescription(raw) {
  const original = String(raw ?? '');
  const value = normalizeDescription(original);
  if (value === '') return fail('Description is required.');
  if (value.length > MAX_DESCRIPTION) {
    return fail(`Description must be ${MAX_DESCRIPTION} characters or fewer.`);
  }
  if (!PATTERNS.description.test(value)) {
    return fail('Description cannot start or end with a space.');
  }
  const extra = {};
  if (value !== original) extra.note = 'Extra spaces were removed.';
  const repeated = findDuplicateWord(value);
  if (repeated) {
    extra.warning = `The word "${repeated}" appears twice in a row. Check for a typo — you can still save.`;
  }
  return ok(value, extra);
}

function parseMoney(raw, { label, allowZero }) {
  const s = String(raw ?? '').trim();
  if (s === '') return fail(`${label} is required.`);
  if (s.startsWith('-')) return fail(`${label} cannot be negative.`);
  if (/^\d*\.?\d+e[+-]?\d+$/i.test(s)) {
    return fail(`${label}: scientific notation (like 1e3) is not allowed.`);
  }
  if (/[^\d.]/.test(s)) {
    return fail(`${label} may contain digits and one decimal point only — no currency symbols, letters or separators.`);
  }
  if (/\.\d{3,}/.test(s)) return fail(`${label} can have at most two decimal places.`);
  if (!PATTERNS.amount.test(s)) {
    return fail(`${label} must look like 12, 12.5 or 12.50 (no leading zeros or trailing decimal point).`);
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return fail(`${label} is not a finite number.`);
  if (n === 0 && !allowZero) return fail(`${label} must be greater than zero.`);
  if (n > MAX_AMOUNT) return fail(`${label} must not exceed ${MAX_AMOUNT.toLocaleString('en-US')}.`);
  return ok(n);
}

function validateAmount(raw) {
  return parseMoney(raw, { label: 'Amount', allowZero: false });
}

function validateCap(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return ok(null);
  return parseMoney(raw, { label: 'Cap', allowZero: true });
}

function validateRate(raw, label = 'Rate') {
  const s = String(raw ?? '').trim();
  if (s === '') return fail(`${label} is required.`);
  if (s.startsWith('-')) return fail(`${label} must be positive.`);
  if (!PATTERNS.rate.test(s)) {
    return fail(`${label} must be a plain number with up to ${RATE_DECIMALS} decimal places (no letters, commas or scientific notation).`);
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return fail(`${label} must be greater than zero.`);
  if (n > MAX_RATE) return fail(`${label} is unrealistically large.`);
  return ok(n);
}

function isRealDate(iso) {
  if (!PATTERNS.date.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function validateDate(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return fail('Date is required.');
  if (!PATTERNS.date.test(s)) return fail('Use the format YYYY-MM-DD, for example 2026-10-08.');
  if (!isRealDate(s)) return fail('That date does not exist on the calendar.');
  const year = Number(s.slice(0, 4));
  if (year < MIN_YEAR || year > MAX_YEAR) return fail(`Year must be between ${MIN_YEAR} and ${MAX_YEAR}.`);
  return ok(s);
}

function displayToIso(text) {
  const m = PATTERNS.displayDate.exec(String(text ?? '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function isoToDisplay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(iso ?? '');
}

function validateDisplayDate(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return fail('Date is required.');
  const iso = displayToIso(s);
  if (!iso) return fail('Use the format DD-MM-YYYY, for example 08-10-2026.');
  return validateDate(iso);
}


function normalizeSpaces(raw) {
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}


function validateCategoryName(raw) {
  const value = normalizeSpaces(raw);
  if (value === '') return fail('Category name is required.');
  if (value.length > MAX_CATEGORY) return fail(`Category name must be ${MAX_CATEGORY} characters or fewer.`);
  if (!PATTERNS.category.test(value)) {
    return fail('Use letters only, with single spaces or hyphens between words (for example "Study abroad").');
  }
  return ok(value);
}

/** Shape check PLUS membership: the category must be one of the configured ones. */
function validateCategory(raw, categories) {
  const named = validateCategoryName(raw);
  if (!named.ok) return named;
  const canonical = categories.find((c) => c.toLowerCase() === named.value.toLowerCase());
  if (!canonical) return fail('Choose one of the existing categories (add new ones in Settings).');
  return ok(canonical);
}

function validateCurrency(raw, fallback = DEFAULT_BASE_CURRENCY) {
  const code = String(raw ?? fallback).trim().toUpperCase();
  return CURRENCIES.includes(code) ? ok(code) : fail(`Currency must be one of ${CURRENCIES.join(', ')}.`);
}

// ------------------------------------------------- whole-form (user input)

/**
 * Validate raw form values.
 * @param {{description:string, amount:string, currency:string, category:string, date:string}} input
 * @param {{categories:string[], baseCurrency:string}} context
 */
function validateTransactionInput(input, context) {
  const errors = {};
  const warnings = {};
  const notes = {};
  const clean = {};

  const description = validateDescription(input.description);
  if (description.ok) {
    clean.description = description.value;
    if (description.warning) warnings.description = description.warning;
    if (description.note) notes.description = description.note;
  } else errors.description = description.error;

  const amount = validateAmount(input.amount);
  if (amount.ok) clean.amount = amount.value;
  else errors.amount = amount.error;

  const currency = validateCurrency(input.currency, context.baseCurrency);
  if (currency.ok) clean.currency = currency.value;
  else errors.currency = currency.error;

  const category = validateCategory(input.category, context.categories);
  if (category.ok) clean.category = category.value;
  else errors.category = category.error;

  const date = validateDisplayDate(input.date);
  if (date.ok) clean.date = date.value;
  else errors.date = date.error;

  const valid = Object.keys(errors).length === 0;
  return { ok: valid, errors, warnings, notes, value: valid ? clean : null };
}

// --------------------------------------------- stored / imported records

/** Strict check of a stored or imported transaction. Returns {errors, warnings, value}. */
function validateStoredTransaction(rec, { categories, baseCurrency }) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(rec)) return { errors: ['is not an object'], warnings, value: null };

  if (typeof rec.id !== 'string' || !PATTERNS.recordId.test(rec.id)) {
    errors.push('"id" must be 1–40 letters, digits, "_" or "-"');
  }

  if (typeof rec.description !== 'string') {
    errors.push('"description" must be text');
  } else {
    const d = validateDescription(rec.description);
    if (!d.ok) errors.push(d.error.replace(/\.$/, ''));
    else if (d.value !== rec.description) errors.push('"description" has leading, trailing or repeated spaces');
    else if (d.warning) warnings.push(`"${rec.description}": ${d.warning}`);
  }

  if (typeof rec.amount !== 'number' || !Number.isFinite(rec.amount)) {
    errors.push('"amount" must be a finite number');
  } else {
    const a = validateAmount(String(rec.amount));
    if (!a.ok) errors.push(a.error.replace(/\.$/, ''));
  }

  // Stored/imported values must already be in canonical form; nothing is silently "fixed".
  const currency = rec.currency === undefined
    ? ok(baseCurrency)
    : (typeof rec.currency === 'string' && CURRENCIES.includes(rec.currency) ? ok(rec.currency) : fail('bad currency'));
  if (!currency.ok) errors.push(`"currency" must be exactly one of ${CURRENCIES.join(', ')}`);

  const category = typeof rec.category === 'string' && categories.includes(rec.category)
    ? ok(rec.category)
    : fail('bad category');
  if (!category.ok) errors.push('"category" must exactly match one of the configured categories');

  const date = typeof rec.date === 'string' ? validateDate(rec.date) : fail('"date" must be text');
  if (!date.ok) errors.push(date.error.replace(/\.$/, ''));
  else if (date.value !== rec.date) errors.push('"date" must be exactly YYYY-MM-DD with no extra spaces');

  for (const key of ['createdAt', 'updatedAt']) {
    const v = rec[key];
    if (typeof v !== 'string' || !PATTERNS.timestamp.test(v) || !isRealDate(v.slice(0, 10)) || Number.isNaN(Date.parse(v))) {
      errors.push(`"${key}" must be an ISO timestamp like 2026-10-08T10:00:00.000Z`);
    }
  }
  if (
    errors.length === 0 && Date.parse(rec.updatedAt) < Date.parse(rec.createdAt)
  ) {
    errors.push('"updatedAt" cannot be earlier than "createdAt"');
  }

  if (errors.length > 0) return { errors, warnings, value: null };
  return {
    errors,
    warnings,
    value: {
      id: rec.id,
      description: rec.description,
      amount: rec.amount,
      currency: currency.value,
      category: category.value,
      date: date.value,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt
    }
  };
}

// ----------------------------------------------------- whole backup file

/**
 * Validate a parsed backup object (JSON import or persisted data).
 * Nothing is applied here — the caller only receives `data` when `ok` is true,
 * which is what guarantees a failed import cannot corrupt existing data.
 * @returns {{ok:boolean, errors:string[], warnings:string[], data:object|null}}
 */
function validateBackup(obj) {
  const errors = [];
  const warnings = [];
  const finish = () => ({ ok: errors.length === 0, errors, warnings, data: null });

  if (!isPlainObject(obj)) {
    errors.push('The file must contain a JSON object at the top level.');
    return finish();
  }
  if (obj.app !== APP_ID) errors.push(`"app" must be "${APP_ID}".`);
  if (obj.version !== SCHEMA_VERSION) errors.push(`"version" must be ${SCHEMA_VERSION}.`);

  // ---- settings
  let settings = null;
  if (!isPlainObject(obj.settings)) {
    errors.push('"settings" must be an object.');
  } else {
    const s = obj.settings;
    const exactCurrency = (v) => (typeof v === 'string' && CURRENCIES.includes(v)
      ? ok(v) : fail(`must be exactly one of ${CURRENCIES.join(', ')}`));
    const base = exactCurrency(s.baseCurrency);
    const display = exactCurrency(s.displayCurrency);
    if (!base.ok) errors.push(`settings.baseCurrency: ${base.error}`);
    if (!display.ok) errors.push(`settings.displayCurrency: ${display.error}`);
    // cap must be present and be either null (no cap) or a real number — never text or an array.
    const cap = s.cap === null
      ? ok(null)
      : (typeof s.cap === 'number' ? validateCap(String(s.cap)) : fail('must be a number or null'));
    if (!cap.ok) errors.push(`settings.cap: ${cap.error}`);

    const rates = {};
    if (!isPlainObject(s.rates)) {
      errors.push('settings.rates must be an object with one rate per currency.');
    } else {
      for (const code of CURRENCIES) {
        const n = s.rates[code];
        const valid = typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= MAX_RATE && roundTo(n, RATE_DECIMALS) === n;
        if (valid) rates[code] = n;
        else errors.push(`settings.rates.${code} must be a positive number (at most ${RATE_DECIMALS} decimals).`);
      }
      if (base.ok && rates[base.value] !== undefined && rates[base.value] !== 1) {
        errors.push(`settings.rates.${base.value} must be exactly 1 because it is the base currency.`);
      }
    }
    if (base.ok && display.ok && cap.ok && Object.keys(rates).length === CURRENCIES.length) {
      settings = { baseCurrency: base.value, displayCurrency: display.value, cap: cap.value, rates };
    }
  }

  // ---- categories
  const categories = [];
  if (!Array.isArray(obj.categories) || obj.categories.length === 0) {
    errors.push('"categories" must be a non-empty array of names.');
  } else if (obj.categories.length > MAX_CATEGORIES) {
    errors.push(`"categories" can hold at most ${MAX_CATEGORIES} names.`);
  } else {
    const seen = new Set();
    obj.categories.forEach((name, i) => {
      const c = typeof name === 'string' ? validateCategoryName(name) : fail('must be text');
      if (!c.ok) errors.push(`categories[${i}]: ${c.error}`);
      else if (c.value !== name) errors.push(`categories[${i}]: "${name}" has extra spaces`);
      else if (seen.has(c.value.toLowerCase())) errors.push(`categories[${i}]: "${name}" is a duplicate`);
      else {
        seen.add(c.value.toLowerCase());
        categories.push(c.value);
      }
    });
    if (errors.length === 0 && !seen.has('other')) {
      categories.push('Other');
      warnings.push('Category "Other" was missing and has been added.');
    }
  }

  // ---- transactions
  const transactions = [];
  if (!Array.isArray(obj.transactions)) {
    errors.push('"transactions" must be an array.');
  } else if (obj.transactions.length > MAX_TRANSACTIONS) {
    errors.push(`"transactions" can hold at most ${MAX_TRANSACTIONS} records.`);
  } else if (settings && categories.length > 0) {
    const firstSeenAt = new Map();
    obj.transactions.forEach((rec, i) => {
      const result = validateStoredTransaction(rec, { categories, baseCurrency: settings.baseCurrency });
      const label = `Transaction ${i + 1}${rec && typeof rec.id === 'string' ? ` (${rec.id})` : ''}`;
      result.errors.forEach((e) => errors.push(`${label}: ${e}.`));
      result.warnings.forEach((w) => warnings.push(w));
      if (result.value) {
        if (firstSeenAt.has(result.value.id)) {
          errors.push(`${label}: duplicate id, already used by transaction ${firstSeenAt.get(result.value.id)}.`);
        } else {
          firstSeenAt.set(result.value.id, i + 1);
          transactions.push(result.value);
        }
      }
    });
  }

  if (errors.length > 0) return finish();
  return { ok: true, errors, warnings, data: { settings, categories, transactions } };
}

/** Default settings object (used by state.js and tests). */
function defaultSettings() {
  return {
    baseCurrency: DEFAULT_BASE_CURRENCY,
    displayCurrency: DEFAULT_BASE_CURRENCY,
    cap: null,
    rates: { ...DEFAULT_RATES }
  };
}

SFT.validators = { APP_ID, SCHEMA_VERSION, MAX_DESCRIPTION, MAX_CATEGORY, MAX_CATEGORIES, MAX_TRANSACTIONS, MAX_AMOUNT, MIN_YEAR, MAX_YEAR, PATTERNS, normalizeDescription, findDuplicateWord, validateDescription, validateAmount, validateCap, validateRate, isRealDate, validateDate, displayToIso, isoToDisplay, validateDisplayDate, normalizeSpaces, validateCategoryName, validateCategory, validateCurrency, validateTransactionInput, validateStoredTransaction, validateBackup, defaultSettings };
})(window.SFT = window.SFT || {});
