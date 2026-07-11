// StageCloset engine: check-out / check-in ledger.
// A checkout is open until returnedAt is set. One open checkout per item.

import { freshId } from './items.js';

export function checkOut(state, itemId, opts) {
  const item = state.items.find(i => i.id === itemId);
  if (!item) return { ok: false, errors: ['Item not found.'] };
  if (item.retired) return { ok: false, errors: ['"' + item.name + '" is retired and cannot be checked out.'] };
  if (openCheckoutFor(state, itemId)) {
    return { ok: false, errors: ['"' + item.name + '" is already checked out.'] };
  }
  const borrower = String((opts && opts.borrower) || '').trim();
  if (!borrower) return { ok: false, errors: ['Borrower name is required.'] };
  const rec = {
    id: freshId('co'),
    itemId,
    borrower,
    contact: String((opts && opts.contact) || '').trim(),
    productionId: (opts && opts.productionId) || null,
    note: String((opts && opts.note) || '').trim(),
    checkedOutAt: (opts && opts.date) || todayISO(),
    dueDate: (opts && opts.dueDate) || '',
    returnedAt: null,
    returnCondition: '',
    returnNote: ''
  };
  state.checkouts.push(rec);
  return { ok: true, checkout: rec };
}

export function checkIn(state, itemId, opts) {
  const rec = openCheckoutFor(state, itemId);
  if (!rec) return { ok: false, errors: ['Item has no open checkout.'] };
  rec.returnedAt = (opts && opts.date) || todayISO();
  rec.returnCondition = String((opts && opts.condition) || '').trim();
  rec.returnNote = String((opts && opts.note) || '').trim();
  if (opts && opts.condition) {
    const item = state.items.find(i => i.id === itemId);
    if (item && ['new', 'good', 'fair', 'needs repair'].includes(opts.condition)) {
      item.condition = opts.condition;
    }
  }
  return { ok: true, checkout: rec };
}

export function openCheckoutFor(state, itemId) {
  return state.checkouts.find(c => c.itemId === itemId && !c.returnedAt) || null;
}

export function openCheckouts(state) {
  return state.checkouts.filter(c => !c.returnedAt);
}

export function historyFor(state, itemId) {
  return state.checkouts
    .filter(c => c.itemId === itemId)
    .sort((a, b) => (a.checkedOutAt < b.checkedOutAt ? 1 : -1));
}

// Days late as of a given date. dueDate empty => never overdue.
export function daysLate(rec, asOf) {
  if (!rec.dueDate || rec.returnedAt) return 0;
  const due = parseISO(rec.dueDate);
  const now = parseISO(asOf || todayISO());
  const diff = Math.floor((now - due) / 86400000);
  return diff > 0 ? diff : 0;
}

export function overdue(state, asOf) {
  return openCheckouts(state)
    .map(c => ({ checkout: c, daysLate: daysLate(c, asOf) }))
    .filter(x => x.daysLate > 0)
    .sort((a, b) => b.daysLate - a.daysLate);
}

// Rollup: who has what, worth how much.
export function borrowerRollup(state) {
  const map = new Map();
  for (const c of openCheckouts(state)) {
    const key = c.borrower.toLowerCase();
    if (!map.has(key)) map.set(key, { borrower: c.borrower, items: [], valueCents: 0 });
    const entry = map.get(key);
    const item = state.items.find(i => i.id === c.itemId);
    entry.items.push({ checkout: c, item });
    entry.valueCents += item ? item.valueCents : 0;
  }
  return Array.from(map.values()).sort((a, b) => b.valueCents - a.valueCents);
}

export function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function parseISO(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return new Date(NaN);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}
