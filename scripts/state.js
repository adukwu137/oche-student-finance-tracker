(function (SFT) {
'use strict';
const { defaultSettings } = SFT.validators;

const DEFAULT_CATEGORIES = Object.freeze(['Food', 'Books', 'Transport', 'Entertainment', 'Fees', 'Other']);
/** Transactions of a deleted category move here. */
const FALLBACK_CATEGORY = 'Other';

function emptyData() {
  return {
    categories: [...DEFAULT_CATEGORIES],
    transactions: [],
    settings: defaultSettings()
  };
}

function generateId(existing) {
  const used = new Set(existing.map((t) => t.id));
  let highest = 0;
  for (const id of used) {
    const match = /^rec_(\d{1,12})$/.exec(id); // ignore absurdly long numbers so ids never overflow into 1e+21
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  let n = highest + 1;
  let id = `rec_${String(n).padStart(4, '0')}`;
  while (used.has(id)) {
    n += 1;
    id = `rec_${String(n).padStart(4, '0')}`;
  }
  return id;
}

function createStore(initial = emptyData()) {
  let data = initial;
  const listeners = new Set();

  function commit(next, reason) {
    data = next;
    listeners.forEach((listener) => listener(data, reason));
  }

  return {
    getState: () => data,

    /** @returns {() => void} unsubscribe function */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    addTransaction(fields, now = new Date()) {
      const stamp = now.toISOString();
      const record = {
        id: generateId(data.transactions),
        description: fields.description,
        amount: fields.amount,
        currency: fields.currency,
        category: fields.category,
        date: fields.date,
        createdAt: stamp,
        updatedAt: stamp
      };
      commit({ ...data, transactions: [...data.transactions, record] }, 'add');
      return record;
    },

    updateTransaction(id, fields, now = new Date()) {
      const index = data.transactions.findIndex((t) => t.id === id);
      if (index === -1) return null;
      const previous = data.transactions[index];
      const record = {
        ...previous,
        description: fields.description,
        amount: fields.amount,
        currency: fields.currency,
        category: fields.category,
        date: fields.date,
        id: previous.id,
        createdAt: previous.createdAt,
        updatedAt: now.toISOString()
      };
      const transactions = data.transactions.map((t, i) => (i === index ? record : t));
      commit({ ...data, transactions }, 'update');
      return record;
    },

    deleteTransaction(id) {
      if (!data.transactions.some((t) => t.id === id)) return false;
      commit({ ...data, transactions: data.transactions.filter((t) => t.id !== id) }, 'delete');
      return true;
    },

    deleteAllTransactions() {
      commit({ ...data, transactions: [] }, 'clear');
    },

    /** `name` must already be validated. Returns false for duplicates (case-insensitive). */
    addCategory(name) {
      if (data.categories.some((c) => c.toLowerCase() === name.toLowerCase())) return false;
      commit({ ...data, categories: [...data.categories, name] }, 'category-add');
      return true;
    },

    /**
     * Remove a category; its transactions are moved to "Other" so none is left
     * pointing at a category that no longer exists.
     * @returns {{ok:boolean, migrated:number}}
     */
    removeCategory(name, now = new Date()) {
      const exists = data.categories.includes(name);
      if (!exists || name === FALLBACK_CATEGORY) return { ok: false, migrated: 0 };
      const stamp = now.toISOString();
      let migrated = 0;
      const transactions = data.transactions.map((t) => {
        if (t.category !== name) return t;
        migrated += 1;
        return { ...t, category: FALLBACK_CATEGORY, updatedAt: stamp };
      });
      commit({ ...data, categories: data.categories.filter((c) => c !== name), transactions }, 'category-remove');
      return { ok: true, migrated };
    },

    setSettings(patch, reason = 'settings') {
      commit({ ...data, settings: { ...data.settings, ...patch } }, reason);
    },

    /** Replace everything with already-validated data (import, sample data, reset). */
    replaceAll(next, reason = 'replace') {
      commit({ categories: [...next.categories], transactions: [...next.transactions], settings: next.settings }, reason);
    }
  };
}

SFT.state = { DEFAULT_CATEGORIES, FALLBACK_CATEGORY, emptyData, generateId, createStore };
})(window.SFT = window.SFT || {});
