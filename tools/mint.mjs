// Mint StageCloset Pro keys. Run: node tools/mint.mjs <seed> [count]
import { mintKey, validateKey } from '../src/engine/license.js';
const seed = process.argv[2] || 'dev';
const count = parseInt(process.argv[3] || '1', 10);
for (let i = 0; i < count; i++) {
  const k = mintKey(seed + (count > 1 ? '-' + (i + 1) : ''));
  console.log(k, validateKey(k) ? '(valid)' : '(INVALID!)');
}
