// StageCloset engine: CSV import (with column auto-mapping) and export.
// The import path is the migration story: every costume closet already has
// a spreadsheet. Paste or drop it in, get a tagged catalog.

import { addItem, CATEGORIES } from './items.js';

// --- CSV parser (quotes, embedded commas/newlines, CRLF) ----------------
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

// --- Column auto-mapper --------------------------------------------------
const COLUMN_SYNONYMS = {
  name: ['name', 'item', 'item name', 'description', 'piece', 'costume', 'title', 'garment'],
  tagId: ['tag', 'tag id', 'tagid', 'id', 'barcode', 'code', 'item #', 'item no', 'number', 'inventory #'],
  category: ['category', 'type', 'kind', 'dept', 'department', 'class'],
  size: ['size', 'sz', 'measurements'],
  colors: ['color', 'colors', 'colour', 'colours'],
  era: ['era', 'period', 'decade', 'style', 'time period'],
  gender: ['gender', 'sex', 'm/f', 'mens/womens'],
  condition: ['condition', 'state', 'quality'],
  room: ['room', 'storage', 'closet', 'area', 'building'],
  rack: ['rack', 'shelf', 'section', 'row'],
  bin: ['bin', 'box', 'container', 'drawer', 'tub'],
  value: ['value', 'price', 'cost', 'replacement', 'replacement value', 'replacement cost', 'worth', '$'],
  notes: ['notes', 'note', 'comments', 'comment', 'remarks', 'details']
};

export function autoMapColumns(headerRow) {
  const mapping = {}; // field -> column index
  const used = new Set();
  const headers = headerRow.map(h => String(h).trim().toLowerCase());
  for (const [field, synonyms] of Object.entries(COLUMN_SYNONYMS)) {
    for (let idx = 0; idx < headers.length; idx++) {
      if (used.has(idx)) continue;
      if (synonyms.includes(headers[idx])) {
        mapping[field] = idx;
        used.add(idx);
        break;
      }
    }
  }
  // Fuzzy pass: header *contains* a synonym (e.g. "Item Description").
  for (const [field, synonyms] of Object.entries(COLUMN_SYNONYMS)) {
    if (mapping[field] !== undefined) continue;
    for (let idx = 0; idx < headers.length; idx++) {
      if (used.has(idx)) continue;
      if (synonyms.some(syn => syn.length > 2 && headers[idx].includes(syn))) {
        mapping[field] = idx;
        used.add(idx);
        break;
      }
    }
  }
  return mapping;
}

// Best-effort category guess from free text like "Victorian dress" or "Props".
export function guessCategory(text) {
  const t = String(text || '').toLowerCase();
  const table = [
    ['dress', ['dress', 'gown', 'frock']],
    ['jacket', ['jacket', 'suit', 'coat', 'blazer', 'vest', 'waistcoat', 'tux']],
    ['shirt', ['shirt', 'blouse', 'top', 'tee', 'sweater']],
    ['pants', ['pant', 'trouser', 'slack', 'jean', 'short', 'breech']],
    ['skirt', ['skirt', 'petticoat', 'tutu']],
    ['shoes', ['shoe', 'boot', 'heel', 'sneaker', 'slipper', 'sandal']],
    ['hat', ['hat', 'cap', 'bonnet', 'helmet', 'crown', 'headband', 'fascinator']],
    ['wig', ['wig', 'hairpiece', 'beard', 'mustache', 'moustache']],
    ['uniform', ['uniform', 'military', 'police', 'nurse', 'scrubs', 'soldier']],
    ['accessory', ['accessor', 'glove', 'scarf', 'belt', 'tie', 'jewel', 'necklace', 'purse', 'bag', 'glasses', 'mask', 'sash', 'suspender', 'apron', 'shawl', 'cape']],
    ['prop', ['prop', 'sword', 'cane', 'umbrella', 'basket', 'lantern', 'book', 'telephone', 'suitcase', 'wand', 'watch', 'clock', 'pipe', 'tray', 'bottle', 'letter']],
    ['set', ['set piece', 'furniture', 'chair', 'table', 'bench', 'backdrop', 'flat']]
  ];
  for (const [id, words] of table) {
    if (words.some(w => t.includes(w))) return id;
  }
  return 'other';
}

// Import rows into state. Returns {ok, imported, skipped, errors[]}
export function importRows(state, rows, mappingArg) {
  if (!rows.length) return { ok: false, imported: 0, skipped: 0, errors: ['No rows found.'] };
  const mapping = mappingArg || autoMapColumns(rows[0]);
  if (mapping.name === undefined) {
    return { ok: false, imported: 0, skipped: 0, errors: ['Could not find a name/item column in the header row.'] };
  }
  let imported = 0, skipped = 0;
  const errors = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const get = f => (mapping[f] !== undefined ? String(row[mapping[f]] || '').trim() : '');
    const name = get('name');
    if (!name) { skipped++; continue; }
    const catText = get('category') || name;
    const res = addItem(state, {
      name,
      tagId: get('tagId'),
      category: normalizeCategoryText(get('category')) || guessCategory(catText),
      size: get('size'),
      colors: get('colors'),
      era: get('era'),
      gender: normalizeGender(get('gender')),
      condition: normalizeCondition(get('condition')),
      room: get('room'),
      rack: get('rack'),
      bin: get('bin'),
      value: get('value'),
      notes: get('notes')
    });
    if (res.ok) imported++;
    else {
      skipped++;
      if (errors.length < 10) errors.push('Row ' + (r + 1) + ': ' + res.errors.join(' '));
    }
  }
  return { ok: true, imported, skipped, errors, mapping };
}

function normalizeCategoryText(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return '';
  const exact = CATEGORIES.find(c => c.id === t || c.label.toLowerCase() === t);
  if (exact) return exact.id;
  return guessCategory(t);
}

function normalizeGender(text) {
  const t = String(text || '').trim().toLowerCase();
  if (['m', 'male', 'men', 'mens', "men's", 'man'].includes(t)) return 'M';
  if (['f', 'female', 'women', 'womens', "women's", 'woman', 'ladies'].includes(t)) return 'F';
  if (['u', 'unisex', 'any', 'either', 'n/a'].includes(t)) return 'U';
  return '';
}

function normalizeCondition(text) {
  const t = String(text || '').trim().toLowerCase();
  if (['new', 'excellent', 'like new', 'mint'].includes(t)) return 'new';
  if (['good', 'ok', 'okay', 'fine'].includes(t)) return 'good';
  if (['fair', 'worn', 'used'].includes(t)) return 'fair';
  if (t.includes('repair') || t.includes('damage') || t.includes('torn') || t.includes('broken') || ['poor', 'bad'].includes(t)) return 'needs repair';
  return 'good';
}

// --- Export ---------------------------------------------------------------
export function exportCSV(state) {
  const header = ['Tag ID', 'Name', 'Category', 'Size', 'Colors', 'Era', 'Gender', 'Condition', 'Room', 'Rack', 'Bin', 'Value', 'Notes', 'Status'];
  const lines = [header.map(csvEscape).join(',')];
  for (const i of state.items) {
    const open = state.checkouts.find(c => c.itemId === i.id && !c.returnedAt);
    lines.push([
      i.tagId, i.name, i.category, i.size.raw, i.colors.join('; '), i.era, i.gender,
      i.condition, i.location.room, i.location.rack, i.location.bin,
      (i.valueCents / 100).toFixed(2), i.notes,
      i.retired ? 'retired' : (open ? 'OUT: ' + open.borrower : 'in')
    ].map(csvEscape).join(','));
  }
  return lines.join('\r\n');
}

export function csvEscape(v) {
  const s = String(v === null || v === undefined ? '' : v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
