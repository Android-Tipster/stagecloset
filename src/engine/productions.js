// StageCloset engine: productions, pull lists, and post-show reconciliation.

import { freshId, locationLabel } from './items.js';
import { openCheckoutFor, parseISO } from './checkout.js';

export const ASSIGNMENT_STATUSES = ['planned', 'pulled', 'fitted', 'returned'];

export function addProduction(state, data) {
  const name = String((data && data.name) || '').trim();
  if (!name) return { ok: false, errors: ['Production name is required.'] };
  const prod = {
    id: freshId('pr'),
    name,
    opens: (data && data.opens) || '',
    closes: (data && data.closes) || '',
    status: 'planning', // planning | running | closed
    notes: String((data && data.notes) || '').trim(),
    createdAt: new Date().toISOString()
  };
  state.productions.push(prod);
  return { ok: true, production: prod };
}

export function setProductionStatus(state, productionId, status) {
  const prod = state.productions.find(p => p.id === productionId);
  if (!prod) return { ok: false, errors: ['Production not found.'] };
  if (!['planning', 'running', 'closed'].includes(status)) {
    return { ok: false, errors: ['Unknown status.'] };
  }
  prod.status = status;
  return { ok: true, production: prod };
}

export function assignItem(state, productionId, itemId, data) {
  const prod = state.productions.find(p => p.id === productionId);
  if (!prod) return { ok: false, errors: ['Production not found.'] };
  const item = state.items.find(i => i.id === itemId);
  if (!item) return { ok: false, errors: ['Item not found.'] };
  if (item.retired) return { ok: false, errors: ['"' + item.name + '" is retired.'] };
  const dup = state.assignments.find(a => a.productionId === productionId && a.itemId === itemId);
  if (dup) return { ok: false, errors: ['"' + item.name + '" is already on this pull list.'] };
  const a = {
    id: freshId('as'),
    productionId,
    itemId,
    character: String((data && data.character) || '').trim(),
    actor: String((data && data.actor) || '').trim(),
    scene: String((data && data.scene) || '').trim(),
    status: 'planned',
    addedAt: new Date().toISOString()
  };
  state.assignments.push(a);
  return { ok: true, assignment: a };
}

export function setAssignmentStatus(state, assignmentId, status) {
  const a = state.assignments.find(x => x.id === assignmentId);
  if (!a) return { ok: false, errors: ['Assignment not found.'] };
  if (!ASSIGNMENT_STATUSES.includes(status)) return { ok: false, errors: ['Unknown status.'] };
  a.status = status;
  return { ok: true, assignment: a };
}

export function unassignItem(state, assignmentId) {
  const idx = state.assignments.findIndex(a => a.id === assignmentId);
  if (idx === -1) return { ok: false, errors: ['Assignment not found.'] };
  state.assignments.splice(idx, 1);
  return { ok: true };
}

export function assignmentsFor(state, productionId) {
  return state.assignments.filter(a => a.productionId === productionId);
}

// Pull sheet grouped by physical location so a volunteer walks the storage
// room once, in order, instead of zig-zagging per character.
export function pullSheet(state, productionId) {
  const rows = assignmentsFor(state, productionId).map(a => {
    const item = state.items.find(i => i.id === a.itemId);
    return { assignment: a, item, location: item ? locationLabel(item) : '' };
  });
  const groups = new Map();
  for (const r of rows) {
    const key = r.location || '(no location)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const grouped = Array.from(groups.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([location, list]) => ({
      location,
      rows: list.sort((a, b) => (a.item && b.item ? a.item.tagId.localeCompare(b.item.tagId) : 0))
    }));
  return { groups: grouped, total: rows.length };
}

// Costume plot: per character, what they wear, in scene order.
export function costumePlot(state, productionId) {
  const rows = assignmentsFor(state, productionId);
  const byChar = new Map();
  for (const a of rows) {
    const key = a.character || '(unassigned)';
    if (!byChar.has(key)) byChar.set(key, { character: key, actor: a.actor, pieces: [] });
    const entry = byChar.get(key);
    if (!entry.actor && a.actor) entry.actor = a.actor;
    const item = state.items.find(i => i.id === a.itemId);
    entry.pieces.push({ assignment: a, item });
  }
  for (const entry of byChar.values()) {
    entry.pieces.sort((a, b) => sceneSort(a.assignment.scene, b.assignment.scene));
  }
  return Array.from(byChar.values()).sort((a, b) => a.character.localeCompare(b.character));
}

function sceneSort(a, b) {
  const na = parseFloat(String(a).replace(/[^0-9.]/g, ''));
  const nb = parseFloat(String(b).replace(/[^0-9.]/g, ''));
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return String(a).localeCompare(String(b));
}

// After closing: anything assigned that never came back, with dollar value.
// "Returned" means assignment marked returned OR item has no open checkout
// tied to this production.
export function reconcile(state, productionId) {
  const missing = [];
  let missingValueCents = 0;
  for (const a of assignmentsFor(state, productionId)) {
    if (a.status === 'returned') continue;
    const item = state.items.find(i => i.id === a.itemId);
    if (!item) continue;
    const open = openCheckoutFor(state, item.id);
    const stillOut = open && open.productionId === productionId;
    // An item is "unreconciled" if its assignment was never marked returned.
    // It is *urgently* missing if it is also still checked out.
    missing.push({
      assignment: a,
      item,
      stillCheckedOut: !!stillOut,
      borrower: stillOut ? open.borrower : ''
    });
    missingValueCents += item.valueCents;
  }
  missing.sort((a, b) => b.item.valueCents - a.item.valueCents);
  return { missing, missingValueCents, assignedCount: assignmentsFor(state, productionId).length };
}

// Items assigned to two productions with overlapping date ranges.
export function conflicts(state) {
  const out = [];
  const byItem = new Map();
  for (const a of state.assignments) {
    if (!byItem.has(a.itemId)) byItem.set(a.itemId, []);
    byItem.get(a.itemId).push(a);
  }
  for (const [itemId, list] of byItem.entries()) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const p1 = state.productions.find(p => p.id === list[i].productionId);
        const p2 = state.productions.find(p => p.id === list[j].productionId);
        if (!p1 || !p2 || p1.status === 'closed' || p2.status === 'closed') continue;
        if (rangesOverlap(p1.opens, p1.closes, p2.opens, p2.closes)) {
          const item = state.items.find(it => it.id === itemId);
          out.push({ item, productions: [p1, p2] });
        }
      }
    }
  }
  return out;
}

export function rangesOverlap(aOpen, aClose, bOpen, bClose) {
  // Missing dates are treated as open-ended: overlap is assumed.
  if (!aOpen || !bOpen) return true;
  const a1 = parseISO(aOpen), a2 = aClose ? parseISO(aClose) : parseISO(aOpen);
  const b1 = parseISO(bOpen), b2 = bClose ? parseISO(bClose) : parseISO(bOpen);
  return a1 <= b2 && b1 <= a2;
}
