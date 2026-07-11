// StageCloset engine: item catalog.
// Pure functions, no DOM, shared between browser and Node tests.

export const CATEGORIES = [
  { id: 'dress', label: 'Dress', prefix: 'DR' },
  { id: 'jacket', label: 'Jacket / Suit', prefix: 'JK' },
  { id: 'shirt', label: 'Shirt / Blouse', prefix: 'SH' },
  { id: 'pants', label: 'Pants / Trousers', prefix: 'PT' },
  { id: 'skirt', label: 'Skirt', prefix: 'SK' },
  { id: 'shoes', label: 'Shoes / Boots', prefix: 'SO' },
  { id: 'hat', label: 'Hat / Headwear', prefix: 'HT' },
  { id: 'accessory', label: 'Accessory', prefix: 'AC' },
  { id: 'wig', label: 'Wig / Hair', prefix: 'WG' },
  { id: 'uniform', label: 'Uniform', prefix: 'UN' },
  { id: 'specialty', label: 'Specialty / Period', prefix: 'SP' },
  { id: 'prop', label: 'Prop', prefix: 'PR' },
  { id: 'set', label: 'Set Piece', prefix: 'ST' },
  { id: 'other', label: 'Other', prefix: 'OT' }
];

export const CONDITIONS = ['new', 'good', 'fair', 'needs repair', 'retired'];

export function categoryById(id) {
  return CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
}

// --- Size normalization -------------------------------------------------
// Wardrobe sizes arrive as free text: "M", "medium", "10", "42R", "W32 L34",
// "6.5", "10-12 kids", "OSFA". We keep the raw string and derive a filter
// class so "find me a Large" works across notations.

const WORD_SIZES = {
  xxs: 'XXS', xs: 'XS', s: 'S', small: 'S', sm: 'S',
  m: 'M', med: 'M', medium: 'M',
  l: 'L', lg: 'L', large: 'L',
  xl: 'XL', xxl: 'XXL', '2xl': 'XXL', '3xl': 'XXXL', xxxl: 'XXXL',
  osfa: 'OSFA', 'one size': 'OSFA', onesize: 'OSFA', os: 'OSFA'
};

export function normalizeSize(raw) {
  const s = String(raw || '').trim();
  if (!s) return { raw: '', cls: '', num: null };
  const lower = s.toLowerCase();
  if (WORD_SIZES[lower]) return { raw: s, cls: WORD_SIZES[lower], num: null };
  // Chest/jacket like "42R", "38L" (explicit length suffix)
  const jacket = lower.match(/^(\d{2})\s*(s|r|l|x)$/);
  if (jacket) {
    const n = parseInt(jacket[1], 10);
    return { raw: s, cls: numToClass(n, 'jacket'), num: n };
  }
  // Waist/inseam "W32 L34" or "32x34"
  const waist = lower.match(/^w?\s*(\d{2})\s*[x/lw]\s*l?\s*(\d{2})$/);
  if (waist) {
    const n = parseInt(waist[1], 10);
    return { raw: s, cls: numToClass(n, 'waist'), num: n };
  }
  // Kids ranges "10-12"
  const range = lower.match(/^(\d{1,2})\s*-\s*(\d{1,2})/);
  if (range) {
    const n = (parseInt(range[1], 10) + parseInt(range[2], 10)) / 2;
    return { raw: s, cls: numToClass(n, 'dress'), num: n };
  }
  // Plain numeric: 28-56 reads as a chest/jacket size, smaller as dress/shoe.
  const num = lower.match(/^(\d{1,2}(?:\.\d)?)$/);
  if (num) {
    const n = parseFloat(num[1]);
    const kind = n >= 28 ? 'jacket' : 'dress';
    return { raw: s, cls: numToClass(n, kind), num: n };
  }
  // Word size buried in text: "size medium", "ladies L"
  for (const key of Object.keys(WORD_SIZES)) {
    const re = new RegExp('(^|\\s)' + key.replace(/\s/g, '\\s') + '($|\\s)');
    if (re.test(lower)) return { raw: s, cls: WORD_SIZES[key], num: null };
  }
  return { raw: s, cls: '', num: null };
}

function numToClass(n, kind) {
  if (kind === 'jacket') {
    if (n <= 34) return 'XS';
    if (n <= 37) return 'S';
    if (n <= 41) return 'M';
    if (n <= 45) return 'L';
    if (n <= 49) return 'XL';
    return 'XXL';
  }
  if (kind === 'waist') {
    if (n <= 28) return 'XS';
    if (n <= 32) return 'S';
    if (n <= 36) return 'M';
    if (n <= 40) return 'L';
    if (n <= 44) return 'XL';
    return 'XXL';
  }
  // dress-size-ish numbers (also covers shoe sizes well enough for filtering)
  if (n <= 2) return 'XS';
  if (n < 8) return 'S';
  if (n <= 10) return 'M';
  if (n <= 14) return 'L';
  if (n <= 18) return 'XL';
  return 'XXL';
}

// --- State + CRUD -------------------------------------------------------

export function emptyState() {
  return {
    items: [],
    checkouts: [],
    productions: [],
    assignments: [],
    counters: {},       // category prefix -> last sequence number
    createdAt: new Date().toISOString()
  };
}

let idSeq = 0;
export function freshId(prefix) {
  idSeq += 1;
  return prefix + '_' + Date.now().toString(36) + '_' + idSeq.toString(36);
}

export function nextTagId(state, categoryId) {
  const cat = categoryById(categoryId);
  const n = (state.counters[cat.prefix] || 0) + 1;
  return cat.prefix + '-' + String(n).padStart(4, '0');
}

export function addItem(state, data) {
  const errors = [];
  const name = String(data.name || '').trim();
  if (!name) errors.push('Name is required.');
  const category = categoryById(data.category).id;
  let tagId = String(data.tagId || '').trim();
  if (tagId && state.items.some(i => i.tagId === tagId)) {
    errors.push('Tag ID "' + tagId + '" is already in use.');
  }
  if (errors.length) return { ok: false, errors };
  if (!tagId) {
    tagId = nextTagId(state, category);
    const prefix = categoryById(category).prefix;
    state.counters[prefix] = (state.counters[prefix] || 0) + 1;
  }
  const size = normalizeSize(data.size);
  const item = {
    id: freshId('it'),
    tagId,
    name,
    category,
    era: String(data.era || '').trim(),
    size,
    colors: parseColors(data.colors),
    gender: data.gender || '',
    condition: CONDITIONS.includes(data.condition) ? data.condition : 'good',
    location: {
      room: String((data.location && data.location.room) || data.room || '').trim(),
      rack: String((data.location && data.location.rack) || data.rack || '').trim(),
      bin: String((data.location && data.location.bin) || data.bin || '').trim()
    },
    valueCents: toCents(data.value),
    notes: String(data.notes || '').trim(),
    photoIds: Array.isArray(data.photoIds) ? data.photoIds.slice() : [],
    retired: false,
    createdAt: data.createdAt || new Date().toISOString()
  };
  state.items.push(item);
  return { ok: true, item };
}

export function updateItem(state, itemId, patch) {
  const item = state.items.find(i => i.id === itemId);
  if (!item) return { ok: false, errors: ['Item not found.'] };
  if (patch.tagId !== undefined) {
    const t = String(patch.tagId).trim();
    if (t && state.items.some(i => i.tagId === t && i.id !== itemId)) {
      return { ok: false, errors: ['Tag ID "' + t + '" is already in use.'] };
    }
    item.tagId = t || item.tagId;
  }
  if (patch.name !== undefined) {
    const n = String(patch.name).trim();
    if (!n) return { ok: false, errors: ['Name is required.'] };
    item.name = n;
  }
  if (patch.category !== undefined) item.category = categoryById(patch.category).id;
  if (patch.era !== undefined) item.era = String(patch.era).trim();
  if (patch.size !== undefined) item.size = normalizeSize(patch.size);
  if (patch.colors !== undefined) item.colors = parseColors(patch.colors);
  if (patch.gender !== undefined) item.gender = patch.gender;
  if (patch.condition !== undefined && CONDITIONS.includes(patch.condition)) item.condition = patch.condition;
  if (patch.room !== undefined) item.location.room = String(patch.room).trim();
  if (patch.rack !== undefined) item.location.rack = String(patch.rack).trim();
  if (patch.bin !== undefined) item.location.bin = String(patch.bin).trim();
  if (patch.value !== undefined) item.valueCents = toCents(patch.value);
  if (patch.notes !== undefined) item.notes = String(patch.notes).trim();
  if (patch.photoIds !== undefined) item.photoIds = patch.photoIds.slice();
  if (patch.retired !== undefined) item.retired = !!patch.retired;
  return { ok: true, item };
}

export function removeItem(state, itemId) {
  const idx = state.items.findIndex(i => i.id === itemId);
  if (idx === -1) return { ok: false, errors: ['Item not found.'] };
  const open = state.checkouts.some(c => c.itemId === itemId && !c.returnedAt);
  if (open) return { ok: false, errors: ['Item is checked out. Check it in before deleting.'] };
  state.items.splice(idx, 1);
  state.assignments = state.assignments.filter(a => a.itemId !== itemId);
  return { ok: true };
}

export function parseColors(input) {
  if (Array.isArray(input)) return input.map(c => String(c).trim().toLowerCase()).filter(Boolean);
  return String(input || '')
    .split(/[,/;+&]/)
    .map(c => c.trim().toLowerCase())
    .filter(Boolean);
}

export function toCents(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Math.max(0, Math.round(v * 100));
  const cleaned = String(v).replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : Math.max(0, Math.round(n * 100));
}

export function fmtMoney(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return sign + '$' + (abs / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function locationLabel(item) {
  return [item.location.room, item.location.rack, item.location.bin].filter(Boolean).join(' / ');
}
