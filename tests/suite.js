(function (SFT) {
'use strict';
const { PATTERNS, normalizeDescription, validateDescription, validateAmount, validateDate, isRealDate, validateCategory, validateCategoryName, validateCap, validateRate, validateTransactionInput, validateBackup, findDuplicateWord, displayToIso, isoToDisplay, validateDisplayDate } = SFT.validators;
const { compileSearch, findRanges, splitByRanges, hasMatch, selectTransactions, renderHighlighted, analyzePattern } = SFT.search;
const { convert, rebaseSettings, formatMoney, sumIn, categoryBreakdown, topCategory, lastSevenDays, capStatus, computeCap, sortTransactions, addDays, daysBetween, todayISO, DEFAULT_RATES, DEFAULT_BASE_CURRENCY, CURRENCIES, formatRate, roundMoney } = SFT.finance;
const { createStore, emptyData, generateId } = SFT.state;
const { buildBackup, exportText, parseBackupText, loadData, saveData, rebaseSeed, STORAGE_KEY, INVALID_BACKUP_SUFFIX } = SFT.storage;

const USD_RATES = { USD: 1, EUR: 0.92, GBP: 0.78, RWF: 1450 };
const usdData = () => { const d = emptyData(); return { ...d, settings: { baseCurrency: 'USD', displayCurrency: 'USD', cap: null, rates: { ...USD_RATES } } }; };
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const skip = (reason) => { const e = new Error(reason); e.skip = true; throw e; };

function assert(condition, message = 'Assertion failed') {
  if (!condition) throw new Error(message);
}

const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
function equal(actual, expected, message = '') {
  const a = canon(actual);
  const b = canon(expected);
  if (a !== b) throw new Error(`${message} Expected ${b} but got ${a}`.trim());
}
function throwsNothing(fn, message) {
  try { fn(); } catch (err) { throw new Error(`${message}: threw ${err.message}`); }
}

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}
class BrokenStorage {
  getItem() { throw new Error('denied'); }
  setItem() { throw new Error('quota'); }
  removeItem() { throw new Error('denied'); }
}

const ctx = { categories: ['Food', 'Books', 'Transport', 'Entertainment', 'Fees', 'Other'], baseCurrency: 'USD' };
const tx = (over = {}) => ({
  id: 'rec_0001', description: 'Lunch', amount: 10, currency: 'USD', category: 'Food', date: '2026-10-08',
  createdAt: '2026-10-08T10:00:00.000Z', updatedAt: '2026-10-08T10:00:00.000Z', ...over
});
const backupOf = (transactions = [tx()], settingsPatch = {}) => ({
  app: 'student-finance-tracker', version: 1, exportedAt: '2026-10-08T10:00:00.000Z',
  settings: { baseCurrency: 'USD', displayCurrency: 'USD', cap: 100, rates: { ...USD_RATES }, ...settingsPatch },
  categories: [...ctx.categories], transactions
});


test('Description: valid text is accepted', () => {
  const r = validateDescription('Lunch at cafeteria');
  assert(r.ok && r.value === 'Lunch at cafeteria');
});
test('Description: empty and whitespace-only are rejected', () => {
  assert(!validateDescription('').ok);
  assert(!validateDescription('    ').ok);
});
test('Description: leading/trailing spaces are trimmed and reported', () => {
  const r = validateDescription('  Bus fare  ');
  assert(r.ok && r.value === 'Bus fare' && r.note);
});
test('Description: repeated internal spaces are collapsed', () => {
  equal(normalizeDescription('a   b \t c'), 'a b c');
  assert(validateDescription('Coffee    with   milk').value === 'Coffee with milk');
});
test('Description: the raw regex rejects leading/trailing whitespace', () => {
  assert(PATTERNS.description.test('ok text'));
  assert(!PATTERNS.description.test(' padded'));
  assert(!PATTERNS.description.test('padded '));
  assert(!PATTERNS.description.test(''));
});
test('Description: over-long text is rejected', () => {
  assert(!validateDescription('x'.repeat(101)).ok);
});
test('Advanced regex (back-reference): detects repeated words', () => {
  equal(findDuplicateWord('Lunch lunch at cafeteria'), 'Lunch');
  equal(findDuplicateWord('the the end'), 'the');
  equal(findDuplicateWord('cat category'), null, 'partial word must not match');
  equal(findDuplicateWord('A normal sentence'), null);
});
test('Advanced regex: repeated word produces a warning, not an error', () => {
  const r = validateDescription('Lunch lunch at cafeteria');
  assert(r.ok && r.warning && r.warning.includes('Lunch'));
});

test('Amount: valid values are accepted', () => {
  for (const v of ['0.5', '12', '12.5', '12.50', '1000000']) assert(validateAmount(v).ok, v);
  equal(validateAmount('12.50').value, 12.5);
});
test('Amount: zero, negative, empty are rejected', () => {
  for (const v of ['0', '0.00', '-5', '', '   ']) assert(!validateAmount(v).ok, v);
});
test('Amount: more than two decimals is rejected, not rounded', () => {
  const r = validateAmount('1.234');
  assert(!r.ok && /two decimal/i.test(r.error));
});
test('Amount: scientific notation, symbols, NaN, Infinity are rejected', () => {
  for (const v of ['1e3', '$5', '5€', 'NaN', 'Infinity', '1,000', '1.2.3', '.5', '5.', '007']) {
    assert(!validateAmount(v).ok, v);
  }
});
test('Amount: absurdly large values are rejected', () => {
  assert(!validateAmount('1000000001').ok);
});
test('Cap: empty means no cap; zero and decimals allowed; junk rejected', () => {
  equal(validateCap('').value, null);
  equal(validateCap(null).value, null);
  equal(validateCap('0').value, 0);
  equal(validateCap('250.5').value, 250.5);
  assert(!validateCap('-1').ok && !validateCap('1.999').ok && !validateCap('abc').ok);
});
test('Exchange rate: positive finite plain decimals only', () => {
  assert(validateRate('0.92').ok && validateRate('1450').ok && validateRate('0.00068966').ok);
  for (const v of ['0', '-1', '', 'abc', '1e3', 'Infinity', '1,5']) assert(!validateRate(v).ok, v);
});

test('Date: valid dates accepted', () => {
  assert(validateDate('2026-10-08').ok && validateDate('2024-02-29').ok);
});
test('Date: wrong formats rejected', () => {
  for (const v of ['2026/10/08', '08-10-2026', '2026-1-8', '2026-13-01', '2026-00-10', '', 'tomorrow']) {
    assert(!validateDate(v).ok, v);
  }
});
test('Date: impossible calendar dates rejected (regex alone would pass them)', () => {
  for (const v of ['2026-02-31', '2026-04-31', '2025-02-29', '2026-06-31']) {
    assert(PATTERNS.date.test(v), `${v} should pass the regex`);
    assert(!validateDate(v).ok && !isRealDate(v), `${v} should fail the calendar check`);
  }
  assert(isRealDate('2028-02-29'));
});
test('Date: year outside 2000–2100 rejected', () => {
  assert(!validateDate('1999-12-31').ok && !validateDate('2101-01-01').ok);
});

test('Category: valid names accepted (case-insensitive match to configured)', () => {
  equal(validateCategory('food', ctx.categories).value, 'Food');
  assert(validateCategoryName('Study abroad').ok && validateCategoryName('Eco-friendly gear').ok);
});
test('Category: invalid names rejected', () => {
  for (const v of ['', 'Food2', 'Food!', ' - ', 'a--b', 'Café']) assert(!validateCategoryName(v).ok, v);
});
test('Category: well-formed but unconfigured category rejected', () => {
  assert(!validateCategory('Holidays', ctx.categories).ok);
});

test('Form validation: valid input produces a clean value', () => {
  const r = validateTransactionInput(
    { description: '  Lunch  ', amount: '12.50', currency: 'USD', category: 'food', date: '08-10-2026' }, ctx);
  assert(r.ok);
  equal(r.value, { description: 'Lunch', amount: 12.5, currency: 'USD', category: 'Food', date: '2026-10-08' });
});
test('Form validation: every invalid field is reported together', () => {
  const r = validateTransactionInput({ description: '', amount: 'x', currency: 'XXX', category: 'Nope', date: '31-02-2026' }, ctx);
  assert(!r.ok && r.value === null);
  equal(Object.keys(r.errors).sort(), ['amount', 'category', 'currency', 'date', 'description']);
});


test('Search: valid pattern compiles; empty pattern means no filter', () => {
  assert(compileSearch('coffee').regex instanceof RegExp);
  const empty = compileSearch('');
  assert(empty.empty && empty.regex === null && empty.error === null);
});
test('Search: invalid regex returns an error and never throws', () => {
  for (const bad of ['(', '[a-', '*abc', '(?<n>', '\\']) {
    let result;
    throwsNothing(() => { result = compileSearch(bad); }, `pattern ${bad}`);
    assert(result.regex === null && /invalid pattern/i.test(result.error), bad);
  }
});
test('Search: over-long pattern is rejected', () => {
  assert(compileSearch('a'.repeat(201)).error);
});
test('Search: case-insensitive vs case-sensitive', () => {
  assert(hasMatch('Coffee run', compileSearch('coffee', true).regex));
  assert(!hasMatch('Coffee run', compileSearch('coffee', false).regex));
  assert(hasMatch('Coffee run', compileSearch('Coffee', false).regex));
});
test('Search: matches are found in order', () => {
  equal(findRanges('tea and coffee and tea', compileSearch('(coffee|tea)').regex), [[0, 3], [8, 14], [19, 22]]);
});
test('Search: zero-length matches cannot loop forever', () => {
  for (const p of ['^', '$', '\\b', '(?=a)', 'x*', '']) {
    const { regex } = compileSearch(p);
    let ranges;
    throwsNothing(() => { ranges = findRanges('banana', regex); }, `pattern "${p}"`);
    assert(Array.isArray(ranges));
  }
  equal(findRanges('banana', compileSearch('a*').regex), [[1, 2], [3, 4], [5, 6]]);
});
test('Search: highlight segments rebuild the original text exactly', () => {
  const text = 'Tea & <b>coffee</b> "quotes"';
  const segments = splitByRanges(text, findRanges(text, compileSearch('coffee|tea').regex));
  equal(segments.map((s) => s.text).join(''), text);
  equal(segments.filter((s) => s.match).map((s) => s.text), ['Tea', 'coffee']);
});
test('Search: example patterns behave as documented', () => {
  assert(hasMatch('Pens 7.50 each', compileSearch('\\.\\d{2}\\b').regex));
  assert(!hasMatch('Bus pass', compileSearch('\\.\\d{2}\\b').regex));
  assert(hasMatch('Lunch lunch at cafe', compileSearch('\\b(\\w+)\\s+\\1\\b').regex));
  assert(!hasMatch('Lunch at cafe', compileSearch('\\b(\\w+)\\s+\\1\\b').regex));
});
test('Search: safe highlighting builds <mark> nodes and never injects HTML (needs DOM)', () => {
  if (typeof document === 'undefined') skip('no DOM in this environment');
  const host = document.createElement('div');
  const payload = '<img src=x onerror=alert(1)> coffee';
  const count = renderHighlighted(host, payload, compileSearch('coffee|img').regex);
  assert(count === 2, 'two highlights expected');
  assert(host.querySelectorAll('img').length === 0, 'no <img> element may be created');
  assert(host.querySelectorAll('mark').length === 2);
  assert(host.textContent === payload, 'text content must be unchanged');
});

const sample = [
  tx({ id: 'rec_0001', description: 'Coffee beans', amount: 9.5, date: '2026-10-08', category: 'Food' }),
  tx({ id: 'rec_0002', description: 'Textbook', amount: 100, date: '2026-09-30', category: 'Books' }),
  tx({ id: 'rec_0003', description: 'bus pass', amount: 35, date: '2026-10-08', category: 'Transport' }),
  tx({ id: 'rec_0004', description: 'Tea', amount: 2.25, date: '2026-10-01', category: 'Food' }),
  tx({ id: 'rec_0005', description: 'Airtime', amount: 5000, currency: 'RWF', date: '2026-10-09', category: 'Other' })
];

test('Sorting: dates sort chronologically both ways, with a stable tie-break', () => {
  const asc = sortTransactions(sample, 'date-asc', 'USD', USD_RATES).map((t) => t.id);
  equal(asc, ['rec_0002', 'rec_0004', 'rec_0001', 'rec_0003', 'rec_0005']);
  const desc = sortTransactions(sample, 'date-desc', 'USD', USD_RATES).map((t) => t.id);
  equal(desc, ['rec_0005', 'rec_0001', 'rec_0003', 'rec_0004', 'rec_0002']);
});
test('Sorting: amounts sort numerically (not as strings) in the display currency', () => {
  const ids = sortTransactions(sample, 'amount-asc', 'USD', USD_RATES).map((t) => t.id);
  equal(ids, ['rec_0004', 'rec_0005', 'rec_0001', 'rec_0003', 'rec_0002']);
  equal(sortTransactions(sample, 'amount-desc', 'USD', USD_RATES)[0].id, 'rec_0002');
});
test('Sorting: descriptions sort A–Z ignoring case, and Z–A', () => {
  equal(sortTransactions(sample, 'description-asc', 'USD', USD_RATES).map((t) => t.description),
    ['Airtime', 'bus pass', 'Coffee beans', 'Tea', 'Textbook']);
  equal(sortTransactions(sample, 'description-desc', 'USD', USD_RATES)[0].description, 'Textbook');
});
test('Sorting does not mutate its input', () => {
  const copy = JSON.stringify(sample);
  sortTransactions(sample, 'amount-desc', 'USD', USD_RATES);
  assert(JSON.stringify(sample) === copy);
});
test('Search + category filter + sort combine correctly', () => {
  const r = selectTransactions(sample, { query: 'coffee|tea', ignoreCase: true, category: 'Food', sort: 'amount-asc' }, 'USD', USD_RATES);
  equal(r.items.map((t) => t.id), ['rec_0004', 'rec_0001']);
  const none = selectTransactions(sample, { query: 'coffee', ignoreCase: false, category: 'all', sort: 'date-asc' }, 'USD', USD_RATES);
  equal(none.items.length, 0, 'case-sensitive "coffee" should miss "Coffee beans"');
  const byCategory = selectTransactions(sample, { query: 'books', ignoreCase: true, category: 'all', sort: 'date-asc' }, 'USD', USD_RATES);
  equal(byCategory.items.map((t) => t.id), ['rec_0002'], 'category names are searchable');
});
test('Invalid search pattern keeps the list and reports the error', () => {
  const r = selectTransactions(sample, { query: '(', ignoreCase: true, category: 'all', sort: 'date-asc' }, 'USD', USD_RATES);
  assert(r.error && r.items.length === sample.length);
});

test('Currency: conversion follows "1 base = X target"', () => {
  assert(Math.abs(convert(100, 'USD', 'EUR', USD_RATES) - 92) < 1e-9);
  assert(Math.abs(convert(1450, 'RWF', 'USD', USD_RATES) - 1) < 1e-9);
  assert(Math.abs(convert(92, 'EUR', 'RWF', USD_RATES) - 145000) < 1e-6);
  equal(convert(7, 'USD', 'USD', USD_RATES), 7);
});
test('Currency: round trip A→B→A returns the original amount', () => {
  const there = convert(123.45, 'GBP', 'RWF', USD_RATES);
  assert(Math.abs(convert(there, 'RWF', 'GBP', USD_RATES) - 123.45) < 1e-9);
});
test('Currency: missing rate throws instead of returning garbage', () => {
  let threw = false;
  try { convert(1, 'USD', 'EUR', { USD: 1 }); } catch { threw = true; }
  assert(threw);
});
test('Currency: changing base keeps real value (rebase)', () => {
  const settings = { baseCurrency: 'USD', displayCurrency: 'USD', cap: 100, rates: { ...USD_RATES } };
  const next = rebaseSettings(settings, 'EUR');
  equal(next.baseCurrency, 'EUR');
  equal(next.rates.EUR, 1);
  equal(next.cap, 92);
  const before = convert(50, 'USD', 'RWF', settings.rates);
  const after = convert(50, 'USD', 'RWF', next.rates);
  assert(Math.abs(before - after) / before < 1e-6, 'conversions must agree after rebasing');
});
test('Currency: formatMoney formats and falls back safely', () => {
  equal(formatMoney(12.5, 'USD'), '$12.50');
  equal(formatMoney(12.5, 'NOT_A_CURRENCY'), 'NOT_A_CURRENCY 12.50');
});

test('Dates: addDays/daysBetween are timezone-proof and handle month ends', () => {
  equal(addDays('2026-10-01', -1), '2026-09-30');
  equal(addDays('2026-12-31', 1), '2027-01-01');
  equal(addDays('2028-02-28', 1), '2028-02-29');
  equal(daysBetween('2026-10-01', '2026-10-10'), 9);
  equal(todayISO(new Date(2026, 9, 8, 23, 59)), '2026-10-08');
});

test('Statistics: empty dataset yields zeros and no top category', () => {
  equal(sumIn([], 'USD', USD_RATES), 0);
  equal(categoryBreakdown([], 'USD', USD_RATES), []);
  equal(topCategory([]), null);
  const week = lastSevenDays([], 'USD', USD_RATES, '2026-10-10');
  assert(week.total === 0 && week.days.length === 7);
});
test('Statistics: totals convert every currency to the display currency', () => {
  // 9.5 + 100 + 35 + 2.25 + 3.45 (5000 RWF) = 150.20
  equal(sumIn(sample, 'USD', USD_RATES), 150.2);
});
test('Statistics: category breakdown sorted with percentages that sum to ~100', () => {
  const rows = categoryBreakdown(sample, 'USD', USD_RATES);
  equal(rows[0].category, 'Books');
  assert(Math.abs(rows.reduce((s, r) => s + r.percent, 0) - 100) < 0.5);
  equal(topCategory(rows).category, 'Books');
});
test('Statistics: seven-day window = today plus six previous days, inclusive', () => {
  const week = lastSevenDays(sample, 'USD', USD_RATES, '2026-10-10');
  equal([week.start, week.end], ['2026-10-04', '2026-10-10']);
  // in window: Oct 8 (9.5 + 35), Oct 9 (3.45); outside: Oct 1, Sep 30
  equal(week.total, 47.95);
  equal(week.days.find((d) => d.date === '2026-10-08').total, 44.5);
  const edge = lastSevenDays([tx({ date: '2026-10-03' }), tx({ id: 'b', date: '2026-10-04' })], 'USD', USD_RATES, '2026-10-10');
  equal(edge.total, 10, 'Oct 4 is inside, Oct 3 is outside');
});

test('Cap: within / near / over states and amounts', () => {
  equal(capStatus(50, 100).state, 'within');
  equal(capStatus(80, 100).state, 'near');
  const over = capStatus(120.5, 100);
  assert(over.state === 'over' && over.over === 20.5 && over.remaining === 0 && over.percent === 100);
  const exact = capStatus(100, 100);
  assert(exact.state === 'near' && exact.remaining === 0, 'exactly at cap is not over');
  equal(capStatus(10, null).state, 'none');
});
test('Cap: zero cap is over as soon as anything is spent', () => {
  equal(capStatus(0, 0).state, 'within');
  equal(capStatus(1, 0).state, 'over');
});
test('Cap: computed in the display currency from a base-currency cap', () => {
  const settings = { baseCurrency: 'USD', displayCurrency: 'EUR', cap: 100, rates: { ...USD_RATES } };
  const status = computeCap([tx({ amount: 50 })], settings);
  equal([status.cap, status.spent, status.remaining, status.state], [92, 46, 46, 'within']);
});

// ------------------------------------------------------------------- state

test('State: add assigns unique ids and identical created/updated timestamps', () => {
  const store = createStore(usdData());
  const a = store.addTransaction({ description: 'A', amount: 1, currency: 'USD', category: 'Food', date: '2026-10-01' }, new Date('2026-10-01T08:00:00Z'));
  const b = store.addTransaction({ description: 'B', amount: 2, currency: 'USD', category: 'Food', date: '2026-10-02' });
  assert(a.id !== b.id && a.createdAt === a.updatedAt);
  equal(a.id, 'rec_0001');
  equal(store.getState().transactions.length, 2);
});
test('State: ids stay unique after deletions (not based on record count)', () => {
  const store = createStore(usdData());
  const fields = { description: 'x', amount: 1, currency: 'USD', category: 'Food', date: '2026-10-01' };
  store.addTransaction(fields); store.addTransaction(fields); const third = store.addTransaction(fields);
  store.deleteTransaction('rec_0001');
  const fourth = store.addTransaction(fields);
  assert(fourth.id !== third.id && fourth.id === 'rec_0004');
  equal(generateId([{ id: 'rec_0009' }, { id: 'custom' }]), 'rec_0010');
  const ids = store.getState().transactions.map((t) => t.id);
  assert(new Set(ids).size === ids.length);
});
test('State: edit keeps id and createdAt, refreshes updatedAt, touches only that record', () => {
  const store = createStore(usdData());
  const fields = { description: 'x', amount: 1, currency: 'USD', category: 'Food', date: '2026-10-01' };
  const a = store.addTransaction(fields, new Date('2026-10-01T08:00:00Z'));
  const b = store.addTransaction({ ...fields, description: 'other' }, new Date('2026-10-01T08:00:00Z'));
  const edited = store.updateTransaction(a.id, { ...fields, description: 'changed', amount: 5 }, new Date('2026-10-05T09:00:00Z'));
  equal(edited.id, a.id);
  equal(edited.createdAt, a.createdAt);
  equal(edited.updatedAt, '2026-10-05T09:00:00.000Z');
  equal(store.getState().transactions.find((t) => t.id === b.id), b, 'other record untouched');
  equal(store.updateTransaction('missing', fields), null);
});
test('State: delete removes exactly one record and reports unknown ids', () => {
  const store = createStore(usdData());
  const fields = { description: 'x', amount: 1, currency: 'USD', category: 'Food', date: '2026-10-01' };
  const a = store.addTransaction(fields); const b = store.addTransaction(fields);
  assert(store.deleteTransaction(a.id) && !store.deleteTransaction(a.id));
  equal(store.getState().transactions.map((t) => t.id), [b.id]);
});
test('State: subscribers are notified and state objects are replaced, not mutated', () => {
  const store = createStore(usdData());
  const reasons = [];
  store.subscribe((_, reason) => reasons.push(reason));
  const before = store.getState();
  store.addTransaction({ description: 'x', amount: 1, currency: 'USD', category: 'Food', date: '2026-10-01' });
  assert(before !== store.getState() && before.transactions.length === 0);
  equal(reasons, ['add']);
});
test('State: removing a category migrates its transactions to Other; Other cannot be removed', () => {
  const store = createStore(usdData());
  store.addTransaction({ description: 'x', amount: 1, currency: 'USD', category: 'Fees', date: '2026-10-01' });
  const result = store.removeCategory('Fees');
  equal(result, { ok: true, migrated: 1 });
  equal(store.getState().transactions[0].category, 'Other');
  assert(!store.getState().categories.includes('Fees'));
  assert(!store.removeCategory('Other').ok);
});
test('State: duplicate category names (any case) are refused', () => {
  const store = createStore(usdData());
  assert(!store.addCategory('food') && store.addCategory('Study abroad'));
});

// ----------------------------------------------------------------- storage

test('localStorage: save then load returns identical data', () => {
  const backend = new MemoryStorage();
  const data = { ...usdData(), transactions: [tx(), tx({ id: 'rec_0002', amount: 3.5 })] };
  assert(saveData(data, backend).ok);
  const loaded = loadData(backend);
  assert(loaded.status === 'ok');
  equal(loaded.data.transactions, data.transactions);
  equal(loaded.data.settings, data.settings);
});
test('localStorage: empty storage reports "empty" so seed data can be offered once', () => {
  equal(loadData(new MemoryStorage()).status, 'empty');
});
test('localStorage: malformed JSON is reported and a copy of the raw text is kept', () => {
  const backend = new MemoryStorage();
  backend.setItem(STORAGE_KEY, '{not json');
  const loaded = loadData(backend);
  assert(loaded.status === 'invalid' && loaded.errors.length > 0);
  equal(backend.getItem(STORAGE_KEY + INVALID_BACKUP_SUFFIX), '{not json');
});
test('localStorage: structurally valid JSON with bad records is rejected', () => {
  const backend = new MemoryStorage();
  backend.setItem(STORAGE_KEY, JSON.stringify(backupOf([tx({ amount: -4 })])));
  equal(loadData(backend).status, 'invalid');
});
test('localStorage: blocked or full storage is handled without throwing', () => {
  const broken = new BrokenStorage();
  equal(loadData(broken).status, 'unavailable');
  assert(!saveData(usdData(), broken).ok && saveData(usdData(), broken).error);
  equal(loadData(null).status, 'unavailable');
  assert(!saveData(usdData(), null).ok);
});
test('localStorage: seed rebasing moves the newest record to today and keeps spacing', () => {
  const data = { ...usdData(), transactions: [tx({ id: 'a', date: '2026-01-10' }), tx({ id: 'b', date: '2026-01-05' })] };
  const out = rebaseSeed(data, '2026-10-10');
  equal(out.transactions.map((t) => t.date), ['2026-10-10', '2026-10-05']);
  assert(parseBackupText(JSON.stringify(buildBackup(out))).ok, 'rebased seed must still be valid');
});

// ----------------------------------------------------------- import/export

test('Import/export: a round trip preserves every field', () => {
  const data = {
    categories: [...ctx.categories, 'Study abroad'],
    settings: { baseCurrency: 'EUR', displayCurrency: 'RWF', cap: 250.5, rates: { USD: 1.08, EUR: 1, GBP: 0.85, RWF: 1566.5 } },
    transactions: [tx(), tx({ id: 'rec_0002', description: 'Pens, pencils (A4)', amount: 0.99, currency: 'EUR', category: 'Study abroad', date: '2026-02-28' })]
  };
  const parsed = parseBackupText(exportText(data));
  assert(parsed.ok, parsed.errors.join('; '));
  equal(parsed.data.transactions, data.transactions);
  equal(parsed.data.categories, data.categories);
  equal(parsed.data.settings, data.settings);
});
test('Import: invalid JSON text is rejected with a clear message', () => {
  const r = parseBackupText('this is not json');
  assert(!r.ok && /not valid JSON/i.test(r.errors[0]) && r.data === null);
});
test('Import: wrong top-level shapes are rejected', () => {
  for (const text of ['[]', 'null', '42', '"text"', '{}']) assert(!parseBackupText(text).ok, text);
});
test('Import: rejects invalid transaction fields', () => {
  const bad = {
    'negative amount': { amount: -1 }, 'zero amount': { amount: 0 }, 'string amount': { amount: '5' },
    'too many decimals': { amount: 1.234 }, 'bad date': { date: '2026-02-31' }, 'wrong date format': { date: '10/08/2026' },
    'unknown category': { category: 'Nope' }, 'untrimmed description': { description: ' Lunch' },
    'empty description': { description: '' }, 'bad timestamp': { createdAt: 'yesterday' },
    'updated before created': { updatedAt: '2020-01-01T00:00:00.000Z' }, 'bad id': { id: 'rec 1!' },
    'bad currency': { currency: 'JPY' }, 'NaN amount': { amount: Number.NaN }
  };
  for (const [name, patch] of Object.entries(bad)) {
    const result = validateBackup(backupOf([tx(patch)]));
    assert(!result.ok && result.data === null, `${name} should be rejected`);
  }
});
test('Import: duplicate ids are rejected', () => {
  const r = validateBackup(backupOf([tx(), tx({ description: 'Other' })]));
  assert(!r.ok && r.errors.some((e) => /duplicate id/i.test(e)));
});
test('Import: invalid settings are rejected (cap, rates, base rate)', () => {
  assert(!validateBackup(backupOf([], { cap: -5 })).ok);
  assert(!validateBackup(backupOf([], { cap: 1.234 })).ok);
  assert(!validateBackup(backupOf([], { rates: { ...USD_RATES, EUR: 0 } })).ok);
  assert(!validateBackup(backupOf([], { rates: { ...USD_RATES, EUR: -1 } })).ok);
  assert(!validateBackup(backupOf([], { rates: { ...USD_RATES, USD: 2 } })).ok);
  assert(!validateBackup(backupOf([], { baseCurrency: 'JPY' })).ok);
  const missing = backupOf(); delete missing.settings.rates.RWF;
  assert(!validateBackup(missing).ok);
});
test('Import: bad app id, version and categories are rejected', () => {
  assert(!validateBackup({ ...backupOf(), app: 'other' }).ok);
  assert(!validateBackup({ ...backupOf(), version: 2 }).ok);
  assert(!validateBackup({ ...backupOf(), categories: [] }).ok);
  assert(!validateBackup({ ...backupOf(), categories: ['Food', 'food', 'Other'] }).ok);
  assert(!validateBackup({ ...backupOf(), categories: ['Food', 'B@d', 'Other'] }).ok);
});
test('Import: failure returns no data, so existing state cannot be partially overwritten', () => {
  const store = createStore({ ...usdData(), transactions: [tx()] });
  const result = parseBackupText(JSON.stringify(backupOf([tx(), tx({ id: 'rec_0002', amount: -1 })])));
  assert(!result.ok && result.data === null);
  if (result.ok) store.replaceAll(result.data);
  equal(store.getState().transactions.length, 1, 'existing data is untouched');
});
test('Import: HTML in text fields is accepted only as inert text', () => {
  const r = validateBackup(backupOf([tx({ description: '<script>alert(1)</script> lunch' })]));
  assert(r.ok, 'allowed as plain text; rendering uses textContent only');
  equal(r.data.transactions[0].description, '<script>alert(1)</script> lunch');
});
test('Import: duplicate words give a warning, not a failure', () => {
  const r = validateBackup(backupOf([tx({ description: 'Lunch lunch' })]));
  assert(r.ok && r.warnings.length === 1);
});
test('Import: missing currency defaults to the file\'s base currency; "Other" is added if absent', () => {
  const record = tx(); delete record.currency;
  const file = { ...backupOf([record]), categories: ['Food'] };
  const r = validateBackup(file);
  assert(r.ok && r.data.transactions[0].currency === 'USD' && r.data.categories.includes('Other'));
});
test('Import: an empty dataset is valid', () => {
  const r = validateBackup(backupOf([]));
  assert(r.ok && r.data.transactions.length === 0);
});

// ----------------------------------------------------------- seed.json

test('seed.json: valid, has 10+ diverse records and the required edge cases', async () => {
  const text = globalThis.SEED_JSON_TEXT ?? JSON.stringify(globalThis.SFT.seedData);
  assert(text, 'seed data is missing');
  const r = parseBackupText(text);
  assert(r.ok, (r.errors || []).join('; '));
  const list = r.data.transactions;
  assert(list.length >= 10, 'needs at least 10 records');
  assert(new Set(list.map((t) => t.category)).size >= 5, 'needs several categories');
  assert(list.some((t) => /coffee/i.test(t.description)), 'needs a coffee record');
  assert(list.some((t) => findDuplicateWord(t.description)), 'needs a duplicate-word record');
  assert(list.some((t) => /[.,:&()-]/.test(t.description)), 'needs punctuation');
  assert(list.some((t) => String(t.amount).includes('.') && String(t.amount).split('.')[1].length === 1), 'needs 1-decimal amount');
  assert(list.some((t) => String(t.amount).split('.')[1]?.length === 2), 'needs 2-decimal amount');
  assert(list.some((t) => t.amount < 2000) && list.some((t) => t.amount >= 50000), 'needs small and large amounts');
  assert(r.data.settings.baseCurrency === 'RWF' && r.data.settings.displayCurrency === 'RWF', 'sample data must be in Rwandan francs');
  assert(new Set(list.map((t) => t.currency)).size >= 2, 'needs one foreign-currency record to show conversion');
  const dates = list.map((t) => t.date);
  assert(new Set(dates).size < dates.length, 'needs two records on the same date for sort tie-breaks');
  const rebased = rebaseSeed(r.data, '2030-05-15');
  const week = lastSevenDays(rebased.transactions, 'RWF', r.data.settings.rates, '2030-05-15');
  assert(week.total > 0 && week.total < sumIn(rebased.transactions, 'RWF', r.data.settings.rates), 'some inside and some outside the window');
  const cap = computeCap(rebased.transactions, r.data.settings);
  assert(cap.state === 'near', `sample data should start "near" the cap for the demo, got ${cap.state}`);
});


const timed = (fn) => { const t = performance.now(); const value = fn(); return { value, ms: performance.now() - t }; };

test('AUDIT regex: catastrophic-backtracking patterns are refused instantly, never executed', () => {
  // Before the fix these froze the tab for 79–124 seconds on a 30-character description.
  for (const p of ['(a+)+$', '(a|aa)+$', '^(\\w+\\s?)*$', '(x+x+)+y', '(a*)*b', '(a?){30}a{30}', '((a|aa))+', '(.*a){20}', 'a+a+a+a+b']) {
    const { value, ms } = timed(() => compileSearch(p));
    assert(value.regex === null && /Pattern refused/.test(value.error), `${p} must be refused`);
    assert(ms < 50, `${p} refusal must be instant (${ms.toFixed(1)}ms)`);
  }
});
test('AUDIT regex: documented example patterns and ordinary patterns are still accepted', () => {
  for (const p of ['\\.\\d{2}\\b', '(coffee|tea)', '\\b(\\w+)\\s+\\1\\b', '^lunch', 'fee.*$', '\\d{3,}', '[A-Z][a-z]+', '(?<=\\$)\\d+', 'a|b|c', '(?:ab)?c', '\\(literal\\)+', '[+*]+']) {
    const r = compileSearch(p);
    assert(r.regex && !r.error, `${p} should be accepted: ${r.error}`);
  }
});
test('AUDIT regex: analyzePattern ignores quantifier characters inside classes and escapes', () => {
  equal(analyzePattern('[+*]+'), null);
  equal(analyzePattern('\\(a+\\)+'), null);
  assert(analyzePattern('(a+)+') !== null && analyzePattern('(a|b)*') !== null);
});
test('AUDIT regex: every accepted pattern in a worst-case matrix finishes quickly', () => {
  const subjects = ['a'.repeat(100), 'ab'.repeat(50), 'word '.repeat(19) + '!', ' '.repeat(100)];
  for (const p of ['a*a*a*b', '.*.*.*x', '\\w*\\w*\\w*!', '(a|b)c', '(\\d+)\\.(\\d+)', '(a)(a)(a)\\3', 'x*y*z*']) {
    const { value: compiled } = timed(() => compileSearch(p));
    assert(compiled.regex, `${p} should compile`);
    const { ms } = timed(() => subjects.forEach((x) => { hasMatch(x, compiled.regex); findRanges(x, compiled.regex); }));
    assert(ms < 250, `${p} took ${ms.toFixed(0)}ms`);
  }
});
test('AUDIT regex: malformed corpus never throws and always yields a readable error', () => {
  const malformed = ['(', ')', '[', '[a-', '[z-a]', '*', '+a', '?', 'a{2,1}', '(?<n>', '(?<n>a)(?<n>b)', '\\', '(?', '(?P<x>a)', '\\k<nope>(?<x>a)', 'a**', '{1}', '(?<=a'];
  for (const p of malformed) {
    let r;
    throwsNothing(() => { r = compileSearch(p); }, `pattern ${p}`);
    assert(r.regex === null && typeof r.error === 'string' && r.error.length > 8, `${p} -> ${JSON.stringify(r)}`);
    assert(!/^Invalid pattern: \/.*\/[a-z]*:/.test(r.error), 'error must not echo the raw /pattern/flags prefix');
  }
});
test('AUDIT regex: zero-width matrix terminates and returns only non-empty ranges', () => {
  for (const p of ['^', '$', '\\b', '\\B', '(?=a)', '(?!a)', '(?<=a)', '(?<!a)', 'a*', 'x*', '(|a)', '^$', '\\b|\\B']) {
    for (const text of ['', 'a', 'banana', '😀a😀', ' ']) {
      const { regex } = compileSearch(p);
      let ranges;
      const { ms } = timed(() => { ranges = findRanges(text, regex); });
      assert(ms < 50, `${p} on ${JSON.stringify(text)} took ${ms}ms`);
      assert(ranges.every(([a, b]) => b > a && b <= text.length), `${p} produced an empty/invalid range`);
    }
  }
  equal(findRanges('banana', compileSearch('a*').regex), [[1, 2], [3, 4], [5, 6]]);
});

test('AUDIT regex: repeated global matching leaves no stale lastIndex between rows', () => {
  const { regex } = compileSearch('a');
  assert(hasMatch('a', regex) && hasMatch('a', regex) && hasMatch('xa', regex) && !hasMatch('x', regex));
  findRanges('aaa', regex);
  assert(hasMatch('a', regex));
});
test('AUDIT highlight: an emoji is never split into two broken halves', () => {
  // Before the fix "." matched each surrogate half separately, producing two marks with � in them.
  const text = 'Pizza 🍕 night';
  const ranges = findRanges(text, compileSearch('🍕').regex);
  equal(ranges, [[6, 8]]);
  equal(findRanges('😀', compileSearch('.').regex), [[0, 2]]);
  const segs = splitByRanges(text, findRanges(text, compileSearch('.{2}').regex));
  assert(segs.every((x) => !/[\ud800-\udbff]$/.test(x.text) && !/^[\udc00-\udfff]/.test(x.text)), 'no segment may start/end inside a surrogate pair');
  equal(segs.map((x) => x.text).join(''), text);
});
test('AUDIT highlight: patterns valid only in non-unicode mode still work (fallback)', () => {
  const r = compileSearch('a\\-b');
  assert(r.regex && hasMatch('a-b', r.regex));
});
test('AUDIT highlight: markup-like text, quotes and ampersands are preserved verbatim in segments', () => {
  const text = `<script>alert("x")</script> & 'q' &amp; <b>`;
  const segs = splitByRanges(text, findRanges(text, compileSearch('script|&amp;|b').regex));
  equal(segs.map((x) => x.text).join(''), text);
  assert(segs.filter((x) => x.match).length >= 3);
});

// ---- impossible dates / negative amounts / decimals, as a table
test('AUDIT dates: calendar table (leap years, month lengths, bounds, lookalike digits)', () => {
  const good = ['2024-02-29', '2028-02-29', '2000-02-29', '2100-02-28', '2026-12-31', '2026-01-01', '2026-04-30'];
  const bad = ['2026-02-29', '2100-02-29', '1900-02-29', '2026-02-30', '2026-04-31', '2026-06-31', '2026-09-31', '2026-11-31',
    '2026-00-10', '2026-13-10', '2026-10-00', '2026-10-32', '0000-01-01', '1999-12-31', '2101-01-01',
    '2026-1-08', '2026-10-8', '26-10-08', '2026/10/08', '2026.10.08', '20261008', '2026-10-08T00:00', '2026-10-08 ', '٢٠٢٦-١٠-٠٨', '２０２６-１０-０８', ''];
  for (const d of good) assert(validateDate(d).ok, `${d} should be valid`);
  for (const d of bad.filter((x) => x !== '2026-10-08 ')) assert(!validateDate(d).ok, `${JSON.stringify(d)} should be invalid`);
  equal(validateDate(' 2026-10-08 ').value, '2026-10-08'); // typed input: surrounding whitespace is trimmed
  assert(!validateBackup(backupOf([tx({ date: '2026-10-08\n' })])).ok, 'but stored/imported dates must be exact');
});
test('AUDIT amounts: negative / decimal / format table', () => {
  const bad = ['-1', '-0', '-0.00', '-0.01', '- 5', '0', '0.0', '0.00', '0.001', '1.005', '12.345', '99.999', '1.', '.5', '+5', '00', '01', '1e2', '1E2', '1e-2', '5e', '0x10', 'NaN', 'nan', 'Infinity', '-Infinity', 'inf', '1,000', '1_000', '1 000', '$5', '5$', '€5', '5 USD', '١٢', '１２', '1..2', '1.2.3', '', ' ', 'abc', '1000000001', '9'.repeat(30)];
  for (const v of bad) assert(!validateAmount(v).ok, `${JSON.stringify(v)} must be rejected`);
  const good = { '0.01': 0.01, '0.1': 0.1, '1': 1, '12.5': 12.5, '12.50': 12.5, '999999999.99': 999999999.99, '1000000000': 1e9, ' 7 ': 7 };
  for (const [v, n] of Object.entries(good)) { const r = validateAmount(v); assert(r.ok && r.value === n, `${v} -> ${JSON.stringify(r)}`); }
  assert(/negative/i.test(validateAmount('-5').error) && /two decimal/i.test(validateAmount('1.234').error));
});

// ---- duplicate ids & malformed persisted/imported data
test('AUDIT ids: huge existing id cannot make generateId emit an invalid id (was "rec_1e+21")', () => {
  const id = generateId([{ id: 'rec_1000000000000000000000' }]);
  assert(PATTERNS.recordId.test(id) && id === 'rec_0001', id);
  assert(generateId([{ id: 'rec_999999999999' }]) === 'rec_1000000000000');
});
test('AUDIT ids: duplicates rejected (exact, adjacent, far apart); case-different ids are distinct', () => {
  const a = tx({ id: 'rec_0001' }); const b = tx({ id: 'rec_0002' });
  assert(!validateBackup(backupOf([a, a])).ok);
  assert(!validateBackup(backupOf([a, b, tx({ id: 'rec_0001', description: 'other' })])).ok);
  const mixed = validateBackup(backupOf([a, tx({ id: 'REC_0001' })]));
  assert(mixed.ok, 'ids are case-sensitive, so these are different');
  const errors = validateBackup(backupOf([a, b, a])).errors.join(' ');
  assert(/duplicate id/i.test(errors) && /transaction 1/.test(errors));
});
test('AUDIT ids: the id "__proto__" is handled safely (no prototype pollution)', () => {
  const r = validateBackup(backupOf([tx({ id: '__proto__' })]));
  assert(r.ok && ({}).polluted === undefined && Object.getPrototypeOf({}) === Object.prototype);
  const polluted = parseBackupText('{"__proto__":{"polluted":true},"app":"x"}');
  assert(!polluted.ok && ({}).polluted === undefined);
});
test('AUDIT ids: store never creates duplicates across add/delete/import cycles', () => {
  const store = createStore(usdData());
  const f = { description: 'x', amount: 1, currency: 'USD', category: 'Food', date: '2026-10-01' };
  for (let i = 0; i < 30; i += 1) { store.addTransaction(f); if (i % 3 === 0) store.deleteTransaction(store.getState().transactions[0].id); }
  const imported = validateBackup(backupOf([tx({ id: 'rec_0100' }), tx({ id: 'rec_0007', description: 'k' })]));
  store.replaceAll(imported.data);
  store.addTransaction(f); store.addTransaction(f);
  const ids = store.getState().transactions.map((t) => t.id);
  assert(new Set(ids).size === ids.length, ids.join());
  assert(ids.includes('rec_0101'));
});
test('AUDIT import: non-canonical stored values are rejected, never silently "fixed"', () => {
  const cases = {
    'lower-case category': backupOf([tx({ category: 'food' })]),
    'padded category': backupOf([tx({ category: ' Food' })]),
    'padded date': backupOf([tx({ date: ' 2026-10-08' })]),
    'lower-case currency': backupOf([tx({ currency: 'usd' })]),
    'lower-case base currency': backupOf([], { baseCurrency: 'usd' }),
    'lower-case display currency': backupOf([], { displayCurrency: 'eur' }),
    'cap as text': backupOf([], { cap: '100' }),
    'cap as empty text': backupOf([], { cap: '' }),
    'cap as array': backupOf([], { cap: [] }),
    'cap as object': backupOf([], { cap: {} }),
    'cap boolean': backupOf([], { cap: false }),
    'cap NaN': backupOf([], { cap: Number.NaN }),
    'cap too precise': backupOf([], { cap: 10.001 }),
    'rates as text': backupOf([], { rates: { USD: '1', EUR: '0.9', GBP: '0.8', RWF: '1400' } }),
    'rate NaN': backupOf([], { rates: { ...USD_RATES, EUR: Number.NaN } }),
    'rate infinity-like': backupOf([], { rates: { ...USD_RATES, EUR: 1e13 } }),
    'impossible timestamp date': backupOf([tx({ createdAt: '2026-02-31T10:00:00.000Z', updatedAt: '2026-03-01T10:00:00.000Z' })]),
    'hour 24 timestamp': backupOf([tx({ createdAt: '2026-10-08T24:00:00.000Z', updatedAt: '2026-10-08T24:00:00.000Z' })]),
    'timestamp without Z': backupOf([tx({ createdAt: '2026-10-08T10:00:00', updatedAt: '2026-10-08T10:00:00' })]),
    'amount as text': backupOf([tx({ amount: '10' })]),
    'amount boolean': backupOf([tx({ amount: true })]),
    'description number': backupOf([tx({ description: 5 })]),
    'transaction null': backupOf([null]),
    'transaction array': backupOf([[]]),
    'transaction string': backupOf(['rec_0001']),
    'transactions not array': { ...backupOf(), transactions: {} },
    'categories not array': { ...backupOf(), categories: 'Food' },
    'settings null': { ...backupOf(), settings: null },
    'settings array': { ...backupOf(), settings: [] }
  };
  for (const [name, file] of Object.entries(cases)) {
    const r = validateBackup(file);
    assert(!r.ok && r.data === null && r.errors.length > 0, `${name} should be rejected`);
  }
  const missingCap = backupOf(); delete missingCap.settings.cap;
  assert(!validateBackup(missingCap).ok, 'missing cap must be rejected');
  assert(validateBackup(backupOf([], { cap: null })).ok && validateBackup(backupOf([], { cap: 0 })).ok, 'null and 0 caps are valid');
});
test('AUDIT import: parseBackupText survives hostile text without throwing', () => {
  const hostile = ['', ' ', 'null', 'true', '0', '"x"', '[]', '{}', '{', '}{', '{"a":', "{'app':1}", '\u0000', 'NaN', '{"app":"student-finance-tracker","version":1}',
    JSON.stringify({ ...backupOf(), transactions: new Array(10001).fill(tx()) }), '[' .repeat(2000) + ']'.repeat(2000)];
  for (const text of hostile) {
    let r;
    throwsNothing(() => { r = parseBackupText(text); }, JSON.stringify(text.slice(0, 20)));
    assert(!r.ok && r.data === null && r.errors.length > 0, `${JSON.stringify(text.slice(0, 30))} should be rejected`);
  }
});
test('AUDIT localStorage: every malformed shape is reported invalid, the raw text is preserved, nothing throws', () => {
  const shapes = ['', '   ', 'null', '[]', '"text"', '42', '{}', '{not json', '{"app":"student-finance-tracker"}',
    JSON.stringify(backupOf([tx(), tx()])), JSON.stringify(backupOf([tx({ amount: -4 })])), JSON.stringify({ ...backupOf(), version: 99 })];
  for (const raw of shapes) {
    const backend = new MemoryStorage();
    backend.setItem(STORAGE_KEY, raw);
    let loaded;
    throwsNothing(() => { loaded = loadData(backend); }, JSON.stringify(raw.slice(0, 25)));
    assert(loaded.status === 'invalid' && loaded.errors.length > 0, `${JSON.stringify(raw.slice(0, 25))} -> ${loaded.status}`);
    equal(backend.getItem(STORAGE_KEY + INVALID_BACKUP_SUFFIX), raw, 'the unreadable text must be kept');
    assert(backend.getItem(STORAGE_KEY) === raw, 'loading must not modify or delete the stored data');
  }
});
test('AUDIT localStorage: valid data written by saveData is accepted after a simulated reload', () => {
  const backend = new MemoryStorage();
  const data = { ...usdData(), transactions: [tx(), tx({ id: 'rec_0002', amount: 0.01, currency: 'RWF', date: '2024-02-29' })] };
  data.settings = rebaseSettings(data.settings, 'RWF'); // rebased (tiny) rates must still pass validation
  assert(saveData(data, backend).ok);
  const loaded = loadData(backend);
  assert(loaded.status === 'ok', JSON.stringify(loaded.errors));
  equal(loaded.data.settings, data.settings);
});

// ---- currency
test('AUDIT currency: conversion table (known values, identity, reciprocal, triangulation)', () => {
  const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
  assert(near(convert(100, 'USD', 'EUR', USD_RATES), 92));
  assert(near(convert(100, 'USD', 'GBP', USD_RATES), 78));
  assert(near(convert(1, 'USD', 'RWF', USD_RATES), 1450));
  assert(near(convert(145000, 'RWF', 'USD', USD_RATES), 100));
  assert(near(convert(92, 'EUR', 'GBP', USD_RATES), 78), 'EUR→GBP goes through the base');
  assert(near(convert(0, 'USD', 'EUR', USD_RATES), 0));
  assert(near(convert(0.01, 'USD', 'USD', USD_RATES), 0.01));
  for (const [a, b] of [['EUR', 'RWF'], ['GBP', 'USD'], ['RWF', 'EUR']]) {
    assert(near(convert(convert(123.45, a, b, USD_RATES), b, a, USD_RATES), 123.45), `${a}->${b}->${a}`);
  }
});
test('AUDIT currency: missing / zero / negative / NaN rates throw instead of returning garbage', () => {
  for (const bad of [{ USD: 1 }, { USD: 1, EUR: 0 }, { USD: 1, EUR: -1 }, { USD: 1, EUR: NaN }, { USD: 1, EUR: Infinity }, { USD: 1, EUR: '0.9' }]) {
    let threw = false;
    try { convert(1, 'USD', 'EUR', bad); } catch { threw = true; }
    assert(threw, JSON.stringify(bad));
  }
});
test('AUDIT currency: rebasing no longer drifts (was 10,150 RWF on $1,000,000)', () => {
  const settings = { baseCurrency: 'USD', displayCurrency: 'USD', cap: 450, rates: { ...USD_RATES } };
  const reference = convert(1_000_000, 'USD', 'RWF', settings.rates);
  let current = settings;
  for (const base of ['RWF', 'EUR', 'GBP', 'USD', 'RWF', 'USD']) {
    current = rebaseSettings(current, base);
    const value = convert(1_000_000, 'USD', 'RWF', current.rates);
    assert(Math.abs(value - reference) / reference < 1e-8, `after rebasing to ${base}: ${value} vs ${reference}`);
    assert(current.rates[base] === 1);
  }
  assert(Math.abs(current.cap - 450) < 0.02, `cap drifted to ${current.cap}`);
});
test('AUDIT currency: rebased rates pass import validation and display as plain decimals', () => {
  const rebased = rebaseSettings({ baseCurrency: 'USD', displayCurrency: 'USD', cap: 100, rates: { ...USD_RATES } }, 'RWF');
  assert(validateBackup(backupOf([], rebased)).ok, 'rebased settings must be importable');
  assert(validateRate(formatRate(rebased.rates.USD)).ok, 'the text shown in the rate box must re-validate');
  equal(formatRate(1), '1'); equal(formatRate(0.92), '0.92'); equal(formatRate(1450), '1450');
  assert(!/e/i.test(formatRate(rebased.rates.USD)));
});
test('AUDIT currency: totals are the same number whichever base is stored', () => {
  const list = [tx({ amount: 10 }), tx({ id: 'b', amount: 5000, currency: 'RWF' }), tx({ id: 'c', amount: 20.5, currency: 'EUR' })];
  const s0 = { baseCurrency: 'USD', displayCurrency: 'USD', cap: null, rates: { ...USD_RATES } };
  const total0 = sumIn(list, 'USD', s0.rates);
  const s1 = rebaseSettings(s0, 'GBP');
  assert(Math.abs(sumIn(list, 'USD', s1.rates) - total0) < 0.005);
});

// ---- date sorting
test('AUDIT sorting: dates across month/year/leap boundaries, unsorted input, both directions', () => {
  const dates = ['2026-01-05', '2025-12-31', '2026-10-08', '2024-02-29', '2026-02-01', '2025-01-01', '2024-03-01', '2026-10-08'];
  const list = dates.map((d, i) => tx({ id: `rec_${String(i + 1).padStart(4, '0')}`, date: d, createdAt: `2026-01-01T00:00:0${i}.000Z`, updatedAt: `2026-01-01T00:00:0${i}.000Z` }));
  const asc = sortTransactions(list, 'date-asc', 'USD', USD_RATES).map((t) => t.date);
  equal(asc, [...dates].sort());
  const desc = sortTransactions(list, 'date-desc', 'USD', USD_RATES).map((t) => t.date);
  equal(desc, [...dates].sort().reverse());
  const tie = sortTransactions(list, 'date-desc', 'USD', USD_RATES).filter((t) => t.date === '2026-10-08').map((t) => t.id);
  equal(tie, ['rec_0003', 'rec_0008'], 'equal dates keep a deterministic order (older created first)');
});
test('AUDIT sorting: amount order uses numbers, not strings ("9" < "10" < "100")', () => {
  const list = ['100', '9', '10', '2.5', '25'].map((a, i) => tx({ id: `r${i}`, amount: Number(a) }));
  equal(sortTransactions(list, 'amount-asc', 'USD', USD_RATES).map((t) => t.amount), [2.5, 9, 10, 25, 100]);
  equal(sortTransactions(list, 'amount-desc', 'USD', USD_RATES).map((t) => t.amount), [100, 25, 10, 9, 2.5]);
});
test('AUDIT sorting: empty and single-item lists, and an unknown sort key, do not throw', () => {
  equal(sortTransactions([], 'date-asc', 'USD', USD_RATES), []);
  equal(sortTransactions([tx()], 'amount-desc', 'USD', USD_RATES).length, 1);
  equal(sortTransactions([tx(), tx({ id: 'b' })], 'nonsense', 'USD', USD_RATES).length, 2);
});

// ---- empty states
test('AUDIT empty: every statistic and the cap are safe on an empty dataset', () => {
  const s = usdData().settings;
  equal(sumIn([], 'USD', s.rates), 0);
  equal(categoryBreakdown([], 'USD', s.rates), []);
  equal(topCategory([]), null);
  const week = lastSevenDays([], 'USD', s.rates, '2026-10-10');
  assert(week.total === 0 && week.days.length === 7 && week.days.every((d) => d.total === 0));
  equal(capStatus(0, null).state, 'none');
  const withCap = computeCap([], { ...s, cap: 100 });
  assert(withCap.state === 'within' && withCap.spent === 0 && withCap.remaining === 100 && withCap.percent === 0);
  const zeroCap = computeCap([], { ...s, cap: 0 });
  assert(zeroCap.state === 'within' && zeroCap.percent === 0 && Number.isFinite(zeroCap.remaining));
  equal(selectTransactions([], { query: 'x', ignoreCase: true, category: 'all', sort: 'date-asc' }, 'USD', s.rates).items, []);
  equal(selectTransactions([], { query: '(', ignoreCase: true, category: 'all', sort: 'date-asc' }, 'USD', s.rates).items.length, 0);
});
test('AUDIT empty: an empty store exports and re-imports', () => {
  const r = parseBackupText(exportText(usdData()));
  assert(r.ok && r.data.transactions.length === 0 && r.data.categories.length === 6);
});

// ---- budget cap
test('AUDIT cap: exact boundary, one cent either side, and zero cap', () => {
  equal(capStatus(99.99, 100).state, 'near');
  equal(capStatus(100, 100).state, 'near');
  assert(capStatus(100, 100).over === 0 && capStatus(100, 100).remaining === 0);
  const over = capStatus(100.01, 100);
  assert(over.state === 'over' && over.over === 0.01 && over.remaining === 0);
  equal(capStatus(79.99, 100).state, 'within');
  equal(capStatus(80, 100).state, 'near');
  equal(capStatus(0, 0).state, 'within');
  equal(capStatus(0.01, 0).state, 'over');
});
test('AUDIT cap: floating-point sums do not create phantom overage (0.1 + 0.2 vs cap 0.3)', () => {
  const settings = { baseCurrency: 'USD', displayCurrency: 'USD', cap: 0.3, rates: { ...USD_RATES } };
  const status = computeCap([tx({ amount: 0.1 }), tx({ id: 'b', amount: 0.2 })], settings);
  assert(status.state !== 'over' && status.over === 0 && status.spent === 0.3, JSON.stringify(status));
  const cents = Array.from({ length: 100 }, (_, i) => tx({ id: `c${i}`, amount: 0.1 }));
  assert(computeCap(cents, { ...settings, cap: 10 }).state !== 'over', '100 × 0.10 must equal 10.00 exactly');
});
test('AUDIT cap: cross-currency boundary — 92 EUR equals a 100 USD cap and is not over', () => {
  const settings = { baseCurrency: 'USD', displayCurrency: 'EUR', cap: 100, rates: { ...USD_RATES } };
  assert(computeCap([tx({ amount: 92, currency: 'EUR' })], settings).state !== 'over');
  assert(computeCap([tx({ amount: 92.01, currency: 'EUR' })], settings).state === 'over');
  const rwf = { ...settings, displayCurrency: 'RWF' };
  assert(computeCap([tx({ amount: 145000, currency: 'RWF' })], rwf).state !== 'over');
  assert(computeCap([tx({ amount: 145001, currency: 'RWF' })], rwf).state === 'over');
});
test('AUDIT cap: the verdict does not depend on which currency is displayed', () => {
  const list = [tx({ amount: 60 }), tx({ id: 'b', amount: 50, currency: 'EUR' }), tx({ id: 'c', amount: 100000, currency: 'RWF' })];
  const base = { baseCurrency: 'USD', cap: 200, rates: { ...USD_RATES } };
  const states = ['USD', 'EUR', 'GBP', 'RWF'].map((d) => computeCap(list, { ...base, displayCurrency: d }).state);
  assert(new Set(states).size === 1, states.join());
});
test('AUDIT cap: deleting back under the cap and raising the cap both change the state', () => {
  const store = createStore({ ...usdData(), settings: { ...usdData().settings, cap: 50 } });
  const f = { description: 'x', amount: 60, currency: 'USD', category: 'Food', date: '2026-10-01' };
  const added = store.addTransaction(f);
  equal(computeCap(store.getState().transactions, store.getState().settings).state, 'over');
  store.setSettings({ cap: 1000 });
  equal(computeCap(store.getState().transactions, store.getState().settings).state, 'within');
  store.setSettings({ cap: 50 });
  store.deleteTransaction(added.id);
  equal(computeCap(store.getState().transactions, store.getState().settings).state, 'within');
  store.setSettings({ cap: null });
  equal(computeCap(store.getState().transactions, store.getState().settings).state, 'none');
});
test('AUDIT cap: validation table (negative, precision, symbols, empty, zero)', () => {
  for (const v of ['-1', '-0.01', '1.999', '1e3', '$5', 'abc', 'NaN', 'Infinity', '1,000', '1000000001']) assert(!validateCap(v).ok, v);
  equal(validateCap('').value, null); equal(validateCap('  ').value, null); equal(validateCap('0').value, 0); equal(validateCap('0.5').value, 0.5);
  equal(roundMoney(0.1 + 0.2), 0.3);
});

// ============================ RWANDAN FRANC DEFAULTS ============================
test('RWF: the app defaults to Rwandan francs (base and display) with a valid illustrative rate table', () => {
  const d = emptyData();
  equal(DEFAULT_BASE_CURRENCY, 'RWF'); equal(d.settings.baseCurrency, 'RWF'); equal(d.settings.displayCurrency, 'RWF');
  equal(CURRENCIES[0], 'RWF');
  equal(d.settings.rates.RWF, 1);
  assert(validateBackup(buildBackup(d)).ok, 'default settings must pass the app\'s own validation');
});
test('RWF: default rates agree with 1 USD = 1450 RWF and 1 EUR = 0.92 USD style round trips', () => {
  const rates = emptyData().settings.rates;
  assert(Math.abs(convert(1, 'USD', 'RWF', rates) - 1450) < 0.01, String(convert(1, 'USD', 'RWF', rates)));
  assert(Math.abs(convert(1450, 'RWF', 'USD', rates) - 1) < 1e-6);
  assert(Math.abs(convert(1, 'EUR', 'RWF', rates) - 1576.087) < 0.01);
  assert(Math.abs(convert(100000, 'RWF', 'GBP', rates) - 53.7931) < 0.001);
});
test('RWF: formatted without minor units, and a manual entry of 2,500 francs is accepted', () => {
  // Intl puts a non-breaking space between the code and the number, so compare with normal spaces.
  const plain = (n) => formatMoney(n, 'RWF').replace(/\s/g, ' ');
  equal(plain(2500), 'RWF 2,500');
  equal(plain(1234567), 'RWF 1,234,567');
  assert(validateAmount('2500').ok && validateAmount('2500.50').ok && !validateAmount('2,500').ok);
});
test('RWF: a cap of RWF 220,000 compares correctly with francs and with dollars', () => {
  const settings = { ...emptyData().settings, cap: 220000 };
  const francs = [tx({ amount: 219999.99, currency: 'RWF' })];
  equal(computeCap(francs, settings).state, 'near');
  equal(computeCap([tx({ amount: 220000.01, currency: 'RWF' })], settings).state, 'over');
  assert(computeCap([tx({ amount: 151.72, currency: 'USD' })], settings).state === 'within' || computeCap([tx({ amount: 151.72, currency: 'USD' })], settings).state === 'near');
  equal(computeCap([tx({ amount: 152, currency: 'USD' })], settings).state, 'over'); // 152 USD = 220,400 RWF
});
test('RWF: switching the display currency to USD keeps the cap and totals consistent', () => {
  const base = emptyData().settings;
  const list = [tx({ amount: 145000, currency: 'RWF' })];
  const rwf = computeCap(list, { ...base, cap: 290000, displayCurrency: 'RWF' });
  const usd = computeCap(list, { ...base, cap: 290000, displayCurrency: 'USD' });
  equal(rwf.state, usd.state);
  assert(Math.abs(usd.spent - 100) < 0.01 && Math.abs(usd.cap - 200) < 0.01, JSON.stringify(usd));
});
test('RWF: rebasing the rwf-based defaults to USD gives the familiar 1450 and 0.92-style rates', () => {
  const next = rebaseSettings(emptyData().settings, 'USD');
  assert(Math.abs(next.rates.RWF - 1450) < 1e-5 && Math.abs(next.rates.EUR - 0.92) < 1e-8, JSON.stringify(next.rates));
  assert(validateBackup(buildBackup({ categories: ['Food', 'Other'], transactions: [], settings: next })).ok);
});

test('Dates typed as DD-MM-YYYY are converted to ISO for storage and validated as real calendar dates', () => {
  equal(displayToIso('08-10-2026'), '2026-10-08');
  equal(isoToDisplay('2026-10-08'), '08-10-2026');
  equal(displayToIso('2026-10-08'), null);
  assert(validateDisplayDate('29-02-2028').ok && validateDisplayDate('29-02-2028').value === '2028-02-29');
  for (const bad of ['31-02-2026', '2026-10-08', '8-10-2026', '08/10/2026', '32-01-2026', '00-10-2026', '08-13-2026', '08-10-26', '', 'abc']) assert(!validateDisplayDate(bad).ok, bad);
  assert(/DD-MM-YYYY/.test(validateDisplayDate('2026-10-08').error));
  const r = validateTransactionInput({ description: 'Lunch', amount: '2500', currency: 'RWF', category: 'Food', date: '08-10-2026' }, ctx);
  assert(r.ok && r.value.date === '2026-10-08', 'the stored value must be the ISO date');
});
test('seed.json and the embedded scripts/seed-data.js contain identical data', () => {
  if (!globalThis.SEED_JSON_TEXT) skip('seed.json text not available here (opened from disk)');
  equal(JSON.parse(globalThis.SEED_JSON_TEXT), globalThis.SFT.seedData);
});

// ------------------------------------------------------------------ runner

async function runAll(filter) {
  const results = [];
  for (const { name, fn } of tests.filter((t) => !filter || t.name.toLowerCase().includes(String(filter).toLowerCase()))) {
    try {
      await fn();
      results.push({ name, status: 'pass' });
    } catch (err) {
      results.push(err.skip ? { name, status: 'skip', detail: err.message } : { name, status: 'fail', detail: err.message });
    }
  }
  return results;
}

SFT.suite = { runAll }; 
})(window.SFT = window.SFT || {});  
