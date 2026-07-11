// Build: inline engine modules + app.js + CSS into one self-contained docs/index.html.
// Run: node build.mjs
// Lesson from MenuLens: use a function replacer, never a string, or "$" in
// code corrupts the bundle.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const MODULES = [
  'src/engine/items.js',
  'src/engine/checkout.js',
  'src/engine/productions.js',
  'src/engine/search.js',
  'src/engine/stats.js',
  'src/engine/csvio.js',
  'src/engine/license.js',
  'src/engine/vault.js',
  'src/app.js'
];

function stripModule(code) {
  return code
    .replace(/^import\s[\s\S]*?from\s+'[^']+';\s*$/gm, '')
    .replace(/^export\s+\{[^}]*\};?\s*$/gm, '')
    .replace(/^export\s+/gm, '');
}

const js = MODULES.map(p => '// ==== ' + p + ' ====\n' + stripModule(readFileSync(p, 'utf8'))).join('\n');
const css = readFileSync('src/style.css', 'utf8');
let html = readFileSync('src/index.html', 'utf8');

html = html.replace(/<!-- BUILD:CSS -->[\s\S]*?<!-- \/BUILD:CSS -->/, () => '<style>\n' + css + '\n</style>');
html = html.replace(/<!-- BUILD:JS -->[\s\S]*?<!-- \/BUILD:JS -->/, () => '<script>\n(function(){\n\'use strict\';\n' + js + '\n})();\n</script>');

mkdirSync('docs', { recursive: true });
writeFileSync('docs/index.html', html);
console.log('Built docs/index.html (' + (html.length / 1024).toFixed(1) + ' KB)');
