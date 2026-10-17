(function (SFT) {
'use strict';
const { createStore, emptyData } = SFT.state;
const { getBackend, loadData, saveData, exportText, parseBackupText, loadSeed, EXPORT_FILENAME, INVALID_BACKUP_SUFFIX, STORAGE_KEY } = SFT.storage;
const { validateTransactionInput, validateRate, validateCap, validateCategoryName, validateDescription, isoToDisplay } = SFT.validators;
const { todayISO, formatMoney, rebaseSettings, CURRENCIES } = SFT.finance;
const ui = SFT.ui;

const $ = (id) => document.getElementById(id);
const SEARCH_DEBOUNCE_MS = 150;
const SEARCH_ANNOUNCE_MS = 800;
const SUBMIT_LOCK_MS = 400;

const filters = { query: '', ignoreCase: true, category: 'all', sort: 'date-desc' };
let store;
let backend;
let editingId = null;
let lastCapState = null;
let submitLocked = false;

// ---------------------------------------------------------------- helpers

const today = () => todayISO();
const money = (n) => formatMoney(n, store.getState().settings.displayCurrency);

function render() {
  return ui.renderAll(store.getState(), filters, today(), { editingId });
}

function persist(data) {
  const result = saveData(data, backend);
  if (!result.ok) ui.announce(result.error, { error: true });
}

/** Announce cap changes only when the state actually changes (avoids repeated interruptions). */
function announceCapTransition(cap) {
  const previous = lastCapState;
  lastCapState = cap.state;
  if (previous === null || previous === cap.state) return;
  if (cap.state === 'over') {
    ui.announce(`Over budget by ${money(cap.over)}. You have spent ${money(cap.spent)} against a cap of ${money(cap.cap)}.`, { urgent: true });
  } else if (cap.state === 'near') {
    ui.announceCap(`Nearly at your cap: ${money(cap.remaining)} remaining.`);
  } else if (cap.state === 'within') {
    ui.announceCap(`Within budget: ${money(cap.remaining)} remaining.`);
  } else {
    ui.announceCap('Spending cap removed.');
  }
}

function onStoreChange(data) {
  persist(data);
  // A replaced/imported data set may no longer contain the category being filtered on.
  if (filters.category !== 'all' && !data.categories.includes(filters.category)) filters.category = 'all';
  const { cap } = render();
  // Defer so the action's own message ("Transaction added") is queued first.
  queueMicrotask(() => announceCapTransition(cap));
}

function focusHeading(id) {
  $(id).focus({ preventScroll: false });
}

// ------------------------------------------------------------- navigation

/** Highlight the nav link of the section currently at the top of the page (and tell assistive tech). */
function wireActiveNav() {
  const links = [...document.querySelectorAll('.nav-link')];
  const sections = links.map((l) => document.getElementById(l.hash.slice(1)));
  let queued = false;
  const update = () => {
    queued = false;
    let current = 0;
    sections.forEach((s, i) => { if (s.getBoundingClientRect().top <= 140) current = i; });
    links.forEach((l, i) => {
      l.classList.toggle('active', i === current);
      if (i === current) l.setAttribute('aria-current', 'location');
      else l.removeAttribute('aria-current');
    });
  };
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  update();
}

function wireNavigation() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || link.getAttribute('href') === '#') return;
    const target = document.getElementById(link.getAttribute('href').slice(1));
    if (!target) return;
    event.preventDefault();
    const focusTarget = target.matches('main') ? target : target.querySelector('h2') ?? target;
    ui.focusAndReveal(focusTarget);
    history.replaceState(null, '', `#${target.id}`);
  });
}

// ------------------------------------------------------------------- form

function enterEditMode(id) {
  const record = store.getState().transactions.find((t) => t.id === id);
  if (!record) return;
  editingId = id;
  ui.clearFormFeedback();
  ui.writeForm({
    description: record.description, amount: record.amount, currency: record.currency,
    category: record.category, date: isoToDisplay(record.date)
  });
  ui.setFormMode(true);
  render();
  ui.focusAndReveal($('form-title'));
  $('description').focus({ preventScroll: true });
}

function leaveEditMode({ restoreFocus = true } = {}) {
  const previousId = editingId;
  editingId = null;
  ui.resetForm(store.getState().settings.baseCurrency);
  ui.setFormMode(false);
  render();
  if (restoreFocus && previousId) {
    const button = document.querySelector(`[data-action="edit"][data-id="${CSS.escape(previousId)}"]`);
    (button ?? $('transactions-title')).focus();
  }
}

function showFormErrors(errors) {
  for (const field of ui.FORM_FIELDS) ui.setFieldError(field, errors[field] ?? '');
  const first = ui.FORM_FIELDS.find((f) => errors[f]);
  if (first) $(first).focus();
}

function handleSubmit(event) {
  event.preventDefault();
  if (submitLocked) return;
  const { categories, settings } = store.getState();
  const result = validateTransactionInput(ui.readForm(), { categories, baseCurrency: settings.baseCurrency });

  ui.setDescriptionFeedback({ note: result.notes.description, warning: result.warnings.description });
  if (!result.ok) {
    showFormErrors(result.errors);
    const count = Object.keys(result.errors).length;
    ui.announce(`The form has ${count} ${count === 1 ? 'error' : 'errors'}. Nothing was saved.`, { error: true });
    return;
  }

  submitLocked = true;
  $('submit-btn').disabled = true;
  setTimeout(() => { submitLocked = false; $('submit-btn').disabled = false; }, SUBMIT_LOCK_MS);

  const summary = `${result.value.description}, ${formatMoney(result.value.amount, result.value.currency)}`
    + (result.warnings.description ? ` Note: ${result.warnings.description}` : '');
  if (editingId) {
    const id = editingId;
    store.updateTransaction(id, result.value);
    ui.announce(`Transaction updated: ${summary}.`);
    leaveEditMode();
  } else {
    store.addTransaction(result.value);
    ui.announce(`Transaction added: ${summary}.`);
    ui.resetForm(store.getState().settings.baseCurrency);
    $('description').focus();
  }
}

/** Re-validate a single field while typing, but only once the user has been told about an error. */
function wireLiveFieldFeedback() {
  const context = () => {
    const { categories, settings } = store.getState();
    return { categories, baseCurrency: settings.baseCurrency };
  };
  for (const field of ui.FORM_FIELDS) {
    const input = $(field);
    const handler = () => {
      const values = ui.readForm();
      const result = validateTransactionInput(values, context());
      if (field === 'description') {
        ui.setDescriptionFeedback({ note: result.notes.description, warning: result.warnings.description });
      }
      if (input.getAttribute('aria-invalid') === 'true') ui.setFieldError(field, result.errors[field] ?? '');
    };
    input.addEventListener('input', handler);
    input.addEventListener('change', handler);
    // Real-time feedback: show a field's error as soon as the user leaves it (if it has content).
    input.addEventListener('blur', () => {
      if (input.value.trim() === '' || $('cancel-edit') === document.activeElement) return;
      ui.setFieldError(field, validateTransactionInput(ui.readForm(), context()).errors[field] ?? '');
    });
  }
  // Description note/warning is only useful once something has been typed.
  $('description').addEventListener('blur', () => {
    const raw = $('description').value;
    if (raw.trim() === '') return;
    const d = validateDescription(raw);
    if (d.ok) $('description').value = d.value; // show the normalised text the app will save
  });
}

// ------------------------------------------------------ transactions table

async function handleTableClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const id = button.dataset.id;
  if (button.dataset.action === 'edit') {
    enterEditMode(id);
  } else if (button.dataset.action === 'delete') {
    const record = store.getState().transactions.find((t) => t.id === id);
    if (!record) return;
    const confirmed = await ui.confirmAction({
      title: 'Delete this transaction?',
      message: `“${record.description}” (${formatMoney(record.amount, record.currency)} on ${isoToDisplay(record.date)}) will be removed. This cannot be undone.`,
      confirmLabel: 'Delete transaction'
    });
    if (!confirmed) {
      button.focus();
      return;
    }
    const wasEditing = editingId === id;
    store.deleteTransaction(id);
    if (wasEditing) leaveEditMode({ restoreFocus: false });
    ui.announce(`Transaction deleted: ${record.description}.`);
    focusHeading('transactions-title');
  }
}

// ----------------------------------------------------------------- search

function wireSearch() {
  const input = $('search-input');
  let debounce;
  let announceTimer;

  const apply = () => {
    filters.query = input.value;
    const { list } = render();
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => {
      if (list.error) ui.announceSearchResults(list.error);
      else if (filters.query !== '') ui.announceSearchResults(list.message);
    }, SEARCH_ANNOUNCE_MS);
  };

  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(apply, SEARCH_DEBOUNCE_MS);
  });

  $('search-ignore-case').addEventListener('change', (e) => {
    filters.ignoreCase = e.target.checked;
    apply();
  });
  $('filter-category').addEventListener('change', (e) => {
    filters.category = e.target.value;
    render();
  });
  $('sort-by').addEventListener('change', (e) => {
    filters.sort = e.target.value;
    render();
  });
  $('filter-form').addEventListener('submit', (e) => e.preventDefault());

  $('search-clear').addEventListener('click', () => {
    input.value = '';
    apply();
    ui.announce('Search cleared.');
    input.focus();
  });

  $('clear-filters').addEventListener('click', () => {
    input.value = '';
    $('search-ignore-case').checked = true;
    $('filter-category').value = 'all';
    $('sort-by').value = 'date-desc';
    Object.assign(filters, { query: '', ignoreCase: true, category: 'all', sort: 'date-desc' });
    render();
    ui.announce('Filters cleared.');
    input.focus();
  });

}

// --------------------------------------------------------------- settings

function wireSettings() {
  $('cap-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const result = validateCap($('set-cap').value);
    ui.setFieldError('set-cap', result.ok ? '' : result.error);
    if (!result.ok) {
      $('set-cap').focus();
      ui.announce('The cap was not saved. Please fix the error.', { error: true });
      return;
    }
    store.setSettings({ cap: result.value }, 'cap');
    if (result.value !== null) {
      ui.announce(`Spending cap saved: ${formatMoney(result.value, store.getState().settings.baseCurrency)}.`);
    }
  });

  $('currency-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const { settings } = store.getState();
    const display = $('set-display').value;
    const base = $('set-base').value;
    if (!CURRENCIES.includes(display) || !CURRENCIES.includes(base)) return;

    let next = { ...settings, displayCurrency: display };
    if (base !== settings.baseCurrency) {
      const confirmed = await ui.confirmAction({
        title: `Change base currency to ${base}?`,
        message: `Exchange rates and your cap will be re-expressed in ${base}. Every transaction keeps its own currency, so no amount changes meaning.`,
        confirmLabel: 'Change base currency'
      });
      if (!confirmed) {
        $('set-base').value = settings.baseCurrency;
        return;
      }
      next = rebaseSettings(next, base);
    }
    store.setSettings(next, 'currency');
    ui.announce(`Currency settings saved. Showing amounts in ${display}; base currency is ${next.baseCurrency}.`);
  });

  $('rates-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const { settings } = store.getState();
    const rates = { ...settings.rates, [settings.baseCurrency]: 1 };
    let firstBad = null;
    for (const code of CURRENCIES.filter((c) => c !== settings.baseCurrency)) {
      const id = `rate-${code}`;
      const result = validateRate($(id).value, `Rate for ${code}`);
      ui.setFieldError(id, result.ok ? '' : result.error);
      if (result.ok) rates[code] = result.value;
      else firstBad ??= id;
    }
    if (firstBad) {
      $(firstBad).focus();
      ui.announce('Exchange rates were not saved. Please fix the errors.', { error: true });
      return;
    }
    store.setSettings({ rates }, 'rates');
    ui.announce('Exchange rates saved.');
  });

  $('category-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const result = validateCategoryName($('new-category').value);
    const exists = result.ok && store.getState().categories.some((c) => c.toLowerCase() === result.value.toLowerCase());
    const message = result.ok ? (exists ? `“${result.value}” already exists.` : '') : result.error;
    ui.setFieldError('new-category', message);
    if (message) {
      $('new-category').focus();
      return;
    }
    store.addCategory(result.value);
    $('new-category').value = '';
    ui.announce(`Category added: ${result.value}.`);
    $('new-category').focus();
  });

  $('category-manage').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action="remove-category"]');
    if (!button) return;
    const name = button.dataset.name;
    const affected = store.getState().transactions.filter((t) => t.category === name).length;
    const confirmed = await ui.confirmAction({
      title: `Remove category “${name}”?`,
      message: affected > 0
        ? `${affected} ${affected === 1 ? 'transaction' : 'transactions'} in this category will be moved to “Other”.`
        : 'No transactions use this category.',
      confirmLabel: 'Remove category'
    });
    if (!confirmed) {
      button.focus();
      return;
    }
    const editedRecord = store.getState().transactions.find((t) => t.id === editingId);
    const { migrated } = store.removeCategory(name);
    if (editedRecord && editedRecord.category === name) leaveEditMode({ restoreFocus: false });
    if (filters.category === name) filters.category = 'all';
    ui.announce(`Category removed: ${name}.${migrated ? ` ${migrated} moved to Other.` : ''}`);
    $('new-category').focus();
  });
}

// ------------------------------------------------------------------- data

async function replaceWithConfirmation({ title, message, confirmLabel, next, success }) {
  const confirmed = await ui.confirmAction({ title, message, confirmLabel });
  if (!confirmed) {
    ui.announce('Cancelled. Nothing was changed.');
    return false;
  }
  editingId = null;
  ui.resetForm(next.settings.baseCurrency);
  ui.setFormMode(false);
  store.replaceAll(next, 'replace');
  ui.announce(success);
  return true;
}

function wireData() {
  $('export-btn').addEventListener('click', () => {
    try {
      ui.downloadText(EXPORT_FILENAME, exportText(store.getState()));
      ui.announce(`Backup exported as ${EXPORT_FILENAME}.`);
    } catch {
      ui.announce('The backup could not be exported.', { error: true });
    }
  });

  $('import-file').addEventListener('change', async (event) => {
    const input = event.target;
    const file = input.files?.[0];
    ui.clearImportErrors();
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error('The file is larger than 5 MB.');
      const result = parseBackupText(await file.text());
      if (!result.ok) {
        ui.showImportErrors(result.errors);
        ui.announce(`Import failed with ${result.errors.length} ${result.errors.length === 1 ? 'problem' : 'problems'}. Nothing was changed.`, { error: true });
        return;
      }
      const current = store.getState().transactions.length;
      const incoming = result.data.transactions.length;
      const done = await replaceWithConfirmation({
        title: 'Replace current data?',
        message: `Your ${current} current ${current === 1 ? 'transaction' : 'transactions'}, categories and settings will be replaced by ${incoming} ${incoming === 1 ? 'transaction' : 'transactions'} from “${file.name}”. This cannot be undone.`,
        confirmLabel: 'Replace data',
        next: result.data,
        success: `Import complete: ${incoming} ${incoming === 1 ? 'transaction' : 'transactions'} loaded.${result.warnings.length ? ` ${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}, such as repeated words in a description.` : ''}`
      });
      if (!done) input.focus();
    } catch (err) {
      ui.showImportErrors([err.message || 'The file could not be read.']);
      ui.announce('Import failed. Nothing was changed.', { error: true });
    } finally {
      input.value = ''; // allow re-importing the same file
    }
  });

  $('load-sample').addEventListener('click', async () => {
    const seed = await loadSeed(today());
    if (!seed.ok) {
      ui.announce(seed.errors[0], { error: true });
      return;
    }
    await replaceWithConfirmation({
      title: 'Load sample data?',
      message: 'This replaces all current transactions, categories and settings with the sample data set.',
      confirmLabel: 'Load sample data',
      next: seed.data,
      success: 'Sample data loaded.'
    });
  });

  $('delete-transactions').addEventListener('click', () => {
    const data = store.getState();
    replaceWithConfirmation({
      title: 'Delete all transactions?',
      message: `All ${data.transactions.length} transactions will be removed. Categories and settings are kept. This cannot be undone.`,
      confirmLabel: 'Delete all transactions',
      next: { ...data, transactions: [] },
      success: 'All transactions deleted.'
    });
  });

  $('reset-all').addEventListener('click', () => {
    replaceWithConfirmation({
      title: 'Reset everything?',
      message: 'Transactions, categories, currency settings and the cap return to their defaults, with no transactions. This cannot be undone.',
      confirmLabel: 'Reset everything',
      next: emptyData(),
      success: 'The app was reset to its defaults.'
    });
  });
}

// ------------------------------------------------------------------- init

async function loadInitialData() {
  backend = getBackend();
  const loaded = loadData(backend);
  switch (loaded.status) {
    case 'ok':
      return { data: loaded.data };
    case 'invalid':
      return {
        data: emptyData(),
        message: `Saved data could not be read, so the app started empty. A copy was kept in browser storage under “${STORAGE_KEY + INVALID_BACKUP_SUFFIX}”.`,
        error: true
      };
    case 'unavailable': {
      const seed = await loadSeed(today());
      return {
        data: seed.ok ? seed.data : emptyData(),
        message: 'Browser storage is unavailable, so changes will not be saved after you close this page.',
        error: true
      };
    }
    default: { // first visit: seed sample data once
      const seed = await loadSeed(today());
      return {
        data: seed.ok ? seed.data : emptyData(),
        message: seed.ok
          ? 'Sample data loaded so you can explore. Use Settings to delete it or start empty.'
          : seed.errors[0],
        // If the sample data could not be fetched, leave storage untouched so the next visit retries
        // instead of permanently saving an empty tracker.
        skipFirstSave: !seed.ok
      };
    }
  }
}

async function init() {
  const { data, message, error, skipFirstSave } = await loadInitialData();
  store = createStore(data);
  if (backend && !skipFirstSave) persist(data); // first save also records "start empty" so seed data is never re-added
  store.subscribe(onStoreChange);

  const { cap } = render();
  lastCapState = cap.state;
  ui.setFormMode(false);
  ui.resetForm(data.settings.baseCurrency);

  wireNavigation();
  wireActiveNav();
  wireLiveFieldFeedback();
  wireSearch();
  wireSettings();
  wireData();
  $('tx-form').addEventListener('submit', handleSubmit);
  $('cancel-edit').addEventListener('click', () => {
    leaveEditMode();
    ui.announce('Editing cancelled.');
  });
  $('use-today').addEventListener('click', () => {
    $('date').value = isoToDisplay(today());
    ui.setFieldError('date', '');
    $('date').focus();
  });
  $('tx-body').addEventListener('click', handleTableClick);

  if (message) ui.announce(message, { error: Boolean(error) });
}

init();
})(window.SFT = window.SFT || {});
