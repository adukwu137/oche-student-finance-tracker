(function (SFT) {
'use strict';
const { CURRENCIES, CURRENCY_NAMES, formatMoney, formatMoneyCompact, convert, sumIn, categoryBreakdown, topCategory, lastSevenDays, computeCap, parseISODate, formatRate } = SFT.finance;
const { selectTransactions, renderHighlighted } = SFT.search;
const { isoToDisplay } = SFT.validators;

const FORM_FIELDS = ['description', 'amount', 'currency', 'category', 'date'];

const byId = (id) => document.getElementById(id);

/** Tiny element factory. String children become text nodes (so they are escaped). */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children);
  return node;
}

function setText(id, text) {
  byId(id).textContent = text;
}

// ------------------------------------------------------- announcements

const clearTimers = new Map();
let politeQueue = [];
let politeTimer = null;

function writeRegion(id, message, isError) {
  const region = byId(id);
  region.classList.toggle('toast-error', Boolean(isError));
  region.textContent = ''; // clear first so repeating a message is announced again
  setTimeout(() => { region.textContent = message; }, 50);
  clearTimeout(clearTimers.get(id));
  clearTimers.set(id, setTimeout(() => { region.textContent = ''; }, 9000));
}

function announce(message, { urgent = false, error = false } = {}) {
  if (urgent) {
    writeRegion('alert-region', message, true);
    return;
  }
  politeQueue.push(message);
  clearTimeout(politeTimer);
  politeTimer = setTimeout(() => {
    writeRegion('status-region', politeQueue.join(' '), error);
    politeQueue = [];
  }, 60);
}

/** Dedicated polite live region for spending-cap status changes. */
function announceCap(message) {
  const region = byId('cap-live');
  region.textContent = '';
  setTimeout(() => { region.textContent = message; }, 50);
}

/** Debounced-by-caller announcement for search result counts (screen-reader only). */
function announceSearchResults(message) {
  const region = byId('search-status');
  region.textContent = '';
  setTimeout(() => { region.textContent = message; }, 50);
}

// -------------------------------------------------------------- dialog

/** Accessible confirmation using the native <dialog> (focus trap, Esc to cancel). */
function confirmAction({ title, message, confirmLabel = 'Confirm' }) {
  const dialog = byId('confirm-dialog');
  if (typeof dialog.showModal !== 'function') {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  setText('dialog-title', title);
  setText('dialog-message', message);
  setText('dialog-confirm', confirmLabel);
  dialog.returnValue = '';
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    dialog.showModal();
    byId('dialog-cancel').focus();
  });
}

// ------------------------------------------------------------ rendering

/** Re-render everything from state. Returns the cap status for announcements. */
function renderAll(data, filters, today, { editingId = null } = {}) {
  const cap = renderDashboard(data, today);
  renderControls(data);
  const list = renderTransactions(data, filters, editingId);
  renderSettings(data);
  return { cap, list };
}

function fillSelect(select, options, preferred) {
  const previous = select.value;
  const unchanged = select.options.length === options.length
    && options.every((o, i) => select.options[i].value === o.value && select.options[i].textContent === o.label);
  // Rebuilding options of a focused <select> makes screen readers re-announce it, so only touch the DOM when needed.
  if (!unchanged) {
    select.replaceChildren(...options.map((o) => el('option', { value: o.value, text: o.label })));
    const wanted = [previous, preferred].find((v) => v && options.some((o) => o.value === v));
    if (wanted) select.value = wanted;
  }
}

const currencyOptions = () => CURRENCIES.map((code) => ({ value: code, label: `${code} – ${CURRENCY_NAMES[code]}` }));

function renderControls(data) {
  const { categories, settings } = data;
  const categoryOptions = categories.map((c) => ({ value: c, label: c }));
  fillSelect(byId('filter-category'), [{ value: 'all', label: 'All categories' }, ...categoryOptions], 'all');
  fillSelect(byId('category'), categoryOptions, categories[0]);
  fillSelect(byId('currency'), currencyOptions(), settings.baseCurrency);
}

// ---- dashboard

function shortDayLabel(iso) {
  const weekday = new Date(parseISODate(iso)).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  return `${weekday} ${Number(iso.slice(8))}`;
}

function renderDashboard(data, today) {
  const { transactions, settings } = data;
  const to = settings.displayCurrency;
  const { rates } = settings;
  const money = (n) => formatMoney(n, to);

  setText('display-currency-label', `${to} (${CURRENCY_NAMES[to]})`);

  const breakdown = categoryBreakdown(transactions, to, rates);
  const top = topCategory(breakdown);
  const week = lastSevenDays(transactions, to, rates, today);

  setText('stat-count', String(transactions.length));
  setText('stat-count-note', transactions.length === 0
    ? 'Nothing recorded yet.'
    : `Across ${breakdown.length} ${breakdown.length === 1 ? 'category' : 'categories'}.`);
  setText('stat-total', money(sumIn(transactions, to, rates)));
  setText('stat-top', top ? top.category : 'None yet');
  setText('stat-top-note', top ? `${money(top.total)} (${top.percent}% of spending)` : 'Add a transaction to see this.');
  setText('stat-week', money(week.total));
  setText('stat-week-note', `${isoToDisplay(week.start)} to ${isoToDisplay(week.end)}`);

  // category breakdown
  const list = byId('breakdown-list');
  list.replaceChildren(...breakdown.map((row) => {
    const bar = el('span', { class: 'bar-fill' });
    bar.style.width = `${row.percent}%`;
    return el('li', { class: 'breakdown-row' },
      el('span', { class: 'breakdown-name', text: row.category }),
      el('span', { class: 'breakdown-value', text: `${money(row.total)}, ${row.percent}%` }),
      el('span', { class: 'bar', 'aria-hidden': 'true' }, bar));
  }));
  byId('breakdown-empty').hidden = breakdown.length > 0;

  // seven-day chart
  setText('week-range', `Today and the six days before it (${isoToDisplay(week.start)} to ${isoToDisplay(week.end)}). Total ${money(week.total)}.`);
  const peak = Math.max(...week.days.map((d) => d.total));
  byId('week-empty').hidden = week.total > 0;
  byId('week-chart').replaceChildren(...week.days.map((day) => {
    const bar = el('span', { class: 'chart-bar' });
    bar.style.setProperty('--pct', peak > 0 ? ((day.total / peak) * 100).toFixed(2) : '0');
    if (day.total === 0) bar.classList.add('is-zero');
    const label = shortDayLabel(day.date);
    return el('li', { class: 'chart-day' },
      el('span', { class: 'chart-value', 'aria-hidden': 'true', text: day.total > 0 ? formatMoneyCompact(day.total, to) : '0' }),
      el('span', { class: 'chart-track', 'aria-hidden': 'true' }, bar),
      el('span', { class: 'chart-label', 'aria-hidden': 'true', text: label }),
      el('span', { class: 'sr-only', text: `${label}: ${money(day.total)}` }));
  }));

  return renderCap(data);
}

const CAP_BADGES = {
  none: 'No cap set',
  within: '✓ Within budget',
  near: '! Nearly at your cap',
  over: '⚠ Over budget'
};

function renderCap(data) {
  const { transactions, settings } = data;
  const to = settings.displayCurrency;
  const money = (n) => formatMoney(n, to);
  const cap = computeCap(transactions, settings);

  const panel = byId('cap-panel');
  panel.dataset.state = cap.state;
  setText('cap-badge', CAP_BADGES[cap.state]);
  byId('cap-bar').style.width = `${cap.percent}%`;

  const figures = byId('cap-figures');
  const detail = byId('cap-detail');
  if (cap.state === 'none') {
    figures.replaceChildren();
    detail.replaceChildren('Set a monthly-style limit in ', el('a', { href: '#settings', text: 'Settings' }), ' to track how much room you have left.');
    return cap;
  }
  const row = (term, value) => el('div', { class: 'cap-row' }, el('dt', { text: term }), el('dd', { text: value }));
  figures.replaceChildren(
    row('Cap', money(cap.cap)),
    row('Spent', `${money(cap.spent)} (${cap.state === 'over' ? 100 : Math.floor(cap.percent)}%)`),
    cap.state === 'over' ? row('Over budget by', money(cap.over)) : row('Remaining', money(cap.remaining)));
  detail.textContent = cap.state === 'over'
    ? `You are ${money(cap.over)} over your cap.`
    : cap.state === 'near'
      ? `Careful: only ${money(cap.remaining)} left before you reach your cap.`
      : `You can still spend ${money(cap.remaining)}.`;
  return cap;
}

// ---- transactions

function cell(label, content, className = '') {
  return el('td', { role: 'cell', 'data-label': label, class: className }, el('span', { class: 'cell-value' }, ...[content].flat()));
}

function highlighted(text, regex) {
  const span = el('span', { class: 'cell-text' });
  renderHighlighted(span, text, regex);
  return span;
}

function buildRow(t, { regex, display, rates, editingId }) {
  const amount = el('span', { class: 'amount', text: formatMoney(t.amount, t.currency) });
  const amountContent = [amount];
  if (t.currency !== display) {
    amountContent.push(el('small', { class: 'converted', text: `≈ ${formatMoney(convert(t.amount, t.currency, display, rates), display)}` }));
  }
  const actions = el('span', { class: 'row-actions' },
    el('button', { type: 'button', class: 'btn btn-small btn-secondary', dataset: { action: 'edit', id: t.id }, 'aria-label': `Edit ${t.description}`, text: 'Edit' }),
    el('button', { type: 'button', class: 'btn btn-small btn-danger-outline', dataset: { action: 'delete', id: t.id }, 'aria-label': `Delete ${t.description}`, text: 'Delete' }));
  return el('tr', { role: 'row', class: t.id === editingId ? 'is-editing' : '', 'aria-current': t.id === editingId ? 'true' : null, dataset: { id: t.id } },
    cell('Date', t.id === editingId
      ? [el('strong', { class: 'editing-flag', text: 'Editing ' }), el('time', { datetime: t.date, text: isoToDisplay(t.date) })]
      : el('time', { datetime: t.date, text: isoToDisplay(t.date) })),
    cell('Description', highlighted(t.description, regex)),
    cell('Category', highlighted(t.category, regex)),
    cell('Amount', amountContent, 'num'),
    cell('Actions', actions));
}

function renderTransactions(data, filters, editingId) {
  const { transactions, settings } = data;
  const { items, error, regex } = selectTransactions(transactions, filters, settings.displayCurrency, settings.rates);

  const input = byId('search-input');
  const errorBox = byId('search-error');
  errorBox.replaceChildren();
  if (error) {
    errorBox.append(el('strong', { text: 'Error: ' }), error);
    input.setAttribute('aria-invalid', 'true');
  } else {
    input.removeAttribute('aria-invalid');
  }

  const context = { regex, display: settings.displayCurrency, rates: settings.rates, editingId };
  byId('tx-body').replaceChildren(...items.map((t) => buildRow(t, context)));

  const total = transactions.length;
  const searching = Boolean(regex);
  const message = searching
    ? `${items.length} of ${total} ${total === 1 ? 'transaction matches' : 'transactions match'} your search and filters.`
    : `Showing ${items.length} of ${total} ${total === 1 ? 'transaction' : 'transactions'}.`;
  setText('result-count', message);

  const empty = byId('tx-empty');
  byId('tx-wrap').hidden = items.length === 0;
  if (total === 0) {
    empty.hidden = false;
    empty.replaceChildren('No transactions yet. ', el('a', { href: '#add', text: 'Add your first transaction' }), ' or load sample data from Settings.');
  } else if (items.length === 0) {
    empty.hidden = false;
    empty.textContent = error
      ? 'Fix the search pattern to see matching transactions.'
      : 'No transactions match your search and filters. Use “Clear filters” to see everything.';
  } else {
    empty.hidden = true;
  }
  return { shown: items.length, total, message, error };
}

// ---- settings

function renderSettings(data) {
  const { settings, categories, transactions } = data;
  setText('cap-base-label', settings.baseCurrency);

  const capInput = byId('set-cap');
  if (document.activeElement !== capInput) capInput.value = settings.cap === null ? '' : String(settings.cap);

  fillSelect(byId('set-display'), currencyOptions(), settings.displayCurrency);
  byId('set-display').value = settings.displayCurrency;
  fillSelect(byId('set-base'), currencyOptions(), settings.baseCurrency);
  byId('set-base').value = settings.baseCurrency;

  const rateBox = byId('rates-fields');
  if (!rateBox.contains(document.activeElement)) {
    setText('rates-intro', `Convention: 1 ${settings.baseCurrency} = X units of the other currency. Example: if 1 ${settings.baseCurrency} = 0.92 EUR, enter 0.92 for EUR.`);
    rateBox.replaceChildren(...CURRENCIES.filter((c) => c !== settings.baseCurrency).map((code) => {
      const id = `rate-${code}`;
      return el('div', { class: 'field' },
        el('label', { for: id, text: `1 ${settings.baseCurrency} equals how many ${code}?` }),
        el('input', { id, type: 'text', inputmode: 'decimal', autocomplete: 'off', value: formatRate(settings.rates[code]), 'aria-describedby': `${id}-hint ${id}-error` }),
        el('p', { class: 'hint', id: `${id}-hint`, text: `Same as 1 ${code} ≈ ${(1 / settings.rates[code]).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${settings.baseCurrency}` }),
        el('p', { class: 'error', id: `${id}-error` }));
    }));
  }

  byId('category-manage').replaceChildren(...categories.map((name) => {
    const count = transactions.filter((t) => t.category === name).length;
    const meta = `${count} ${count === 1 ? 'transaction' : 'transactions'}`;
    const control = name === 'Other'
      ? el('span', { class: 'muted', text: 'Fallback category' })
      : el('button', { type: 'button', class: 'btn btn-small btn-danger-outline', dataset: { action: 'remove-category', name }, 'aria-label': `Remove category ${name}`, text: 'Remove' });
    return el('li', { class: 'category-item' },
      el('span', { class: 'category-name' }, el('strong', { text: name }), ` (${meta})`),
      control);
  }));
}

function setFieldError(inputId, message) {
  const input = byId(inputId);
  const box = byId(`${inputId}-error`);
  box.replaceChildren();
  if (message) {
    box.append(el('strong', { text: 'Error: ' }), message);
    input.setAttribute('aria-invalid', 'true');
  } else {
    input.removeAttribute('aria-invalid');
  }
}

function setDescriptionFeedback({ note = '', warning = '' } = {}) {
  setText('description-note', note);
  const box = byId('description-warning');
  box.replaceChildren();
  if (warning) box.append(el('strong', { text: 'Warning: ' }), warning);
}

function readForm() {
  return Object.fromEntries(FORM_FIELDS.map((f) => [f, byId(f).value]));
}

function writeForm(values) {
  for (const f of FORM_FIELDS) if (values[f] !== undefined) byId(f).value = String(values[f]);
}

function clearFormFeedback() {
  FORM_FIELDS.forEach((f) => setFieldError(f, ''));
  setDescriptionFeedback();
}

function resetForm(baseCurrency) {
  byId('tx-form').reset();
  byId('currency').value = baseCurrency;
  clearFormFeedback();
}

function setFormMode(editing) {
  setText('form-title', editing ? 'Edit transaction' : 'Add transaction');
  setText('submit-btn', editing ? 'Save changes' : 'Add transaction');
  byId('cancel-edit').hidden = !editing;
  setText('form-intro', editing
    ? 'Change the details below, then save. The original creation time is kept.'
    : 'All fields are required. Extra spaces in the description are removed automatically.');
}

function showImportErrors(errors) {
  const box = byId('import-errors');
  const shown = errors.slice(0, 8);
  const items = shown.map((e) => el('li', { text: e }));
  if (errors.length > shown.length) items.push(el('li', { text: `…and ${errors.length - shown.length} more problems.` }));
  box.replaceChildren(el('p', {}, el('strong', { text: 'Import failed. Nothing was changed.' })), el('ul', {}, ...items));
  box.hidden = false;
}

function clearImportErrors() {
  const box = byId('import-errors');
  box.replaceChildren();
  box.hidden = true;
}

function focusAndReveal(target, { smooth = true } = {}) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: smooth && !reduce ? 'smooth' : 'auto', block: 'start' });
  target.focus({ preventScroll: true });
}

function downloadText(filename, text, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

SFT.ui = { FORM_FIELDS, el, announce, announceCap, announceSearchResults, confirmAction, renderAll, setFieldError, setDescriptionFeedback, readForm, writeForm, clearFormFeedback, resetForm, setFormMode, showImportErrors, clearImportErrors, focusAndReveal, downloadText };
})(window.SFT = window.SFT || {});


