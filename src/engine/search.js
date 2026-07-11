// StageCloset engine: search + structured filters over the catalog.

import { locationLabel } from './items.js';
import { openCheckoutFor } from './checkout.js';

// filters: { q, category, sizeClass, gender, condition, status, era, location }
// status: '' | 'in' | 'out' | 'repair' | 'retired'
export function searchItems(state, filters) {
  const f = filters || {};
  const tokens = tokenize(f.q);
  return state.items.filter(item => {
    if (f.category && item.category !== f.category) return false;
    if (f.sizeClass && item.size.cls !== f.sizeClass) return false;
    if (f.gender && item.gender !== f.gender) return false;
    if (f.condition && item.condition !== f.condition) return false;
    if (f.era && !item.era.toLowerCase().includes(String(f.era).toLowerCase())) return false;
    if (f.location) {
      const loc = locationLabel(item).toLowerCase();
      if (!loc.includes(String(f.location).toLowerCase())) return false;
    }
    if (f.status) {
      const out = !!openCheckoutFor(state, item.id);
      if (f.status === 'in' && (out || item.retired)) return false;
      if (f.status === 'out' && !out) return false;
      if (f.status === 'repair' && item.condition !== 'needs repair') return false;
      if (f.status === 'retired' && !item.retired) return false;
    } else if (item.retired) {
      // Retired items stay out of default views unless asked for.
      return false;
    }
    if (tokens.length) {
      const hay = haystack(item);
      for (const t of tokens) {
        if (!hay.includes(t)) return false;
      }
    }
    return true;
  });
}

export function tokenize(q) {
  return String(q || '')
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 0);
}

function haystack(item) {
  return [
    item.name,
    item.tagId,
    item.category,
    item.era,
    item.size.raw,
    item.size.cls,
    item.colors.join(' '),
    item.gender,
    item.notes,
    locationLabel(item)
  ].join(' ').toLowerCase();
}
