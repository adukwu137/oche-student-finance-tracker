(function (SFT) {
'use strict';
const { APP_ID, SCHEMA_VERSION, validateBackup } = SFT.validators;
const { addDays, daysBetween, parseISODate } = SFT.finance;

const STORAGE_KEY = 'studentFinanceTracker:v1';
const INVALID_BACKUP_SUFFIX = ':invalid-backup';
const EXPORT_FILENAME = 'student-finance-backup.json';

/** The real localStorage, or null when it is missing or blocked (private mode, policy). */
function getBackend() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const probe = '__sft_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

/** Build the versioned document used for both saving and exporting. */
function buildBackup(data, now = new Date()) {
  return {
    app: APP_ID,
    version: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    settings: {
      baseCurrency: data.settings.baseCurrency,
      displayCurrency: data.settings.displayCurrency,
      cap: data.settings.cap,
      rates: { ...data.settings.rates }
    },
    categories: [...data.categories],
    transactions: data.transactions.map((t) => ({
      id: t.id,
      description: t.description,
      amount: t.amount,
      currency: t.currency,
      category: t.category,
      date: t.date,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt
    }))
  };
}

function exportText(data, now = new Date()) {
  return JSON.stringify(buildBackup(data, now), null, 2);
}

function parseBackupText(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`The file is not valid JSON (${err.message}).`], warnings: [], data: null };
  }
  return validateBackup(parsed);
}

/**
 * @returns {{status:'ok'|'empty'|'invalid'|'unavailable', data?:object, errors?:string[], warnings?:string[]}}
 */
function loadData(backend, key = STORAGE_KEY) {
  if (!backend) return { status: 'unavailable' };
  let raw;
  try {
    raw = backend.getItem(key);
  } catch {
    return { status: 'unavailable' };
  }
  if (raw === null || raw === undefined) return { status: 'empty' };

  const result = parseBackupText(raw);
  if (result.ok) return { status: 'ok', data: result.data, warnings: result.warnings };

  try {
    backend.setItem(key + INVALID_BACKUP_SUFFIX, raw); // keep the unreadable copy
  } catch {
    /* nothing more we can do */
  }
  return { status: 'invalid', errors: result.errors };
}

/** @returns {{ok:boolean, error?:string}} */
function saveData(data, backend, key = STORAGE_KEY, now = new Date()) {
  if (!backend) {
    return { ok: false, error: 'Browser storage is unavailable, so changes will be lost when you close this page.' };
  }
  try {
    backend.setItem(key, JSON.stringify(buildBackup(data, now)));
    return { ok: true };
  } catch {
    return { ok: false, error: 'Your changes could not be saved (storage may be full or blocked). Export a backup to keep your data.' };
  }
}

function clearStored(backend, key = STORAGE_KEY) {
  try {
    backend?.removeItem(key);
  } catch {
    /* ignore */
  }
}

function rebaseSeed(data, today) {
  if (data.transactions.length === 0) return data;
  const latest = data.transactions.reduce((a, t) => (parseISODate(t.date) > parseISODate(a) ? t.date : a), data.transactions[0].date);
  const shift = daysBetween(latest, today);
  const transactions = data.transactions.map((t) => {
    const date = addDays(t.date, shift);
    const stamp = `${date}T12:00:00.000Z`;
    return { ...t, date, createdAt: stamp, updatedAt: stamp };
  });
  return { ...data, transactions };
}

/** Fetch and validate seed.json. @returns {Promise<{ok:boolean, data?:object, errors?:string[]}>} */
async function loadSeed(today, fetchFn = globalThis.fetch, url = 'seed.json') {
  // scripts/seed-data.js embeds the same data as seed.json so the app also works when opened straight from disk.
  if (globalThis.SFT && globalThis.SFT.seedData) {
    const embedded = parseBackupText(JSON.stringify(globalThis.SFT.seedData));
    return embedded.ok ? { ok: true, data: rebaseSeed(embedded.data, today) } : { ok: false, errors: embedded.errors };
  }
  try {
    const response = await fetchFn(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = parseBackupText(await response.text());
    if (!result.ok) return { ok: false, errors: result.errors };
    return { ok: true, data: rebaseSeed(result.data, today) };
  } catch (err) {
    return { ok: false, errors: [`Sample data could not be loaded (${err.message}).`] };
  }
}

SFT.storage = { STORAGE_KEY, INVALID_BACKUP_SUFFIX, EXPORT_FILENAME, getBackend, buildBackup, exportText, parseBackupText, loadData, saveData, clearStored, rebaseSeed, loadSeed };
})(window.SFT = window.SFT || {});
