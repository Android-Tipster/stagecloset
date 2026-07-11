// StageCloset offline Pro licenses.
// Format: STAGECLOSET-XXXX-XXXX-XXXX (Crockford base32 blocks).
// Third block is an FNV-1a checksum of the first two, so any minted key
// validates offline with no server and no seed list.
// GOTCHA: the prefix itself contains S/T/A/G/E/C/L/O — L and O normalize to
// 1 and 0 under typo tolerance, so ALWAYS compare normalized-to-normalized.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32
const PREFIX = 'STAGECLOSET';

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function toBase32(n, len) {
  let out = '';
  for (let i = 0; i < len; i++) {
    out = ALPHABET[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return out;
}

// Normalize common typos: O->0, I->1, L->1, lowercase -> uppercase.
export function normalizeKey(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/[^0-9A-Z]/g, '');
}

const NORM_PREFIX = normalizeKey(PREFIX);

export function checksumBlock(b1, b2) {
  return toBase32(fnv1a(NORM_PREFIX + '|' + b1 + '|' + b2), 4);
}

export function mintKey(seed) {
  const h1 = fnv1a('stagecloset-a|' + seed);
  const h2 = fnv1a('stagecloset-b|' + seed);
  const b1 = toBase32(h1, 4);
  const b2 = toBase32(h2, 4);
  const b3 = checksumBlock(b1, b2);
  return PREFIX + '-' + b1 + '-' + b2 + '-' + b3;
}

export function validateKey(raw) {
  const norm = normalizeKey(raw);
  if (!norm.startsWith(NORM_PREFIX)) return false;
  const rest = norm.slice(NORM_PREFIX.length);
  if (rest.length !== 12) return false;
  const b1 = rest.slice(0, 4);
  const b2 = rest.slice(4, 8);
  const b3 = rest.slice(8, 12);
  if (![b1, b2, b3].every(b => [...b].every(ch => ALPHABET.includes(ch)))) return false;
  return checksumBlock(b1, b2) === b3;
}
