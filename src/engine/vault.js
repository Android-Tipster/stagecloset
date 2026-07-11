// StageCloset vault: whole-closet backup and restore.
// This is the volunteer-turnover answer: outgoing wardrobe manager exports
// one .stagecloset file, incoming manager imports it. Nothing is lost in
// the handover, no account required.

export const VAULT_FORMAT = 'stagecloset-vault';
export const VAULT_VERSION = 1;

export function serializeVault(state, opts) {
  const includePhotos = !!(opts && opts.photos);
  return JSON.stringify({
    format: VAULT_FORMAT,
    version: VAULT_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      items: state.items,
      checkouts: state.checkouts,
      productions: state.productions,
      assignments: state.assignments,
      counters: state.counters,
      createdAt: state.createdAt
    },
    photos: includePhotos ? (opts.photos === true ? {} : opts.photos) : undefined
  });
}

export function parseVault(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: ['Not a valid vault file (JSON parse failed).'] };
  }
  if (!obj || obj.format !== VAULT_FORMAT) {
    return { ok: false, errors: ['Not a StageCloset vault file.'] };
  }
  if (typeof obj.version !== 'number' || obj.version > VAULT_VERSION) {
    return { ok: false, errors: ['This vault was made by a newer version of StageCloset. Update the app first.'] };
  }
  const d = obj.data || {};
  const state = {
    items: Array.isArray(d.items) ? d.items : [],
    checkouts: Array.isArray(d.checkouts) ? d.checkouts : [],
    productions: Array.isArray(d.productions) ? d.productions : [],
    assignments: Array.isArray(d.assignments) ? d.assignments : [],
    counters: d.counters && typeof d.counters === 'object' ? d.counters : {},
    createdAt: d.createdAt || new Date().toISOString()
  };
  // Integrity: drop checkouts/assignments pointing at items that don't exist.
  const ids = new Set(state.items.map(i => i.id));
  state.checkouts = state.checkouts.filter(c => ids.has(c.itemId));
  state.assignments = state.assignments.filter(a => ids.has(a.itemId));
  return { ok: true, state, photos: obj.photos || {}, exportedAt: obj.exportedAt };
}
