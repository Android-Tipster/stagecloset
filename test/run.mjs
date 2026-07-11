// StageCloset test suite. Run: node test/run.mjs
import {
  emptyState, addItem, updateItem, removeItem, normalizeSize, parseColors,
  toCents, fmtMoney, nextTagId, locationLabel, CATEGORIES
} from '../src/engine/items.js';
import {
  checkOut, checkIn, openCheckoutFor, openCheckouts, historyFor,
  daysLate, overdue, borrowerRollup
} from '../src/engine/checkout.js';
import {
  addProduction, setProductionStatus, assignItem, setAssignmentStatus,
  unassignItem, pullSheet, costumePlot, reconcile, conflicts, rangesOverlap
} from '../src/engine/productions.js';
import { searchItems, tokenize } from '../src/engine/search.js';
import { dashboard } from '../src/engine/stats.js';
import { parseCSV, autoMapColumns, guessCategory, importRows, exportCSV, csvEscape } from '../src/engine/csvio.js';
import { mintKey, validateKey, normalizeKey } from '../src/engine/license.js';
import { serializeVault, parseVault } from '../src/engine/vault.js';

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('FAIL: ' + msg); }
}
function eq(a, b, msg) {
  ok(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')');
}

// ---------- size normalization ----------
eq(normalizeSize('M').cls, 'M', 'letter size M');
eq(normalizeSize('medium').cls, 'M', 'word size medium');
eq(normalizeSize('XL').cls, 'XL', 'XL passthrough');
eq(normalizeSize('10').cls, 'M', 'dress size 10 -> M');
eq(normalizeSize('16').cls, 'XL', 'dress size 16 -> XL');
eq(normalizeSize('42R').cls, 'L', 'jacket 42R -> L');
eq(normalizeSize('42R').num, 42, 'jacket 42R numeric');
eq(normalizeSize('W32 L34').cls, 'S', 'waist W32 L34 -> S (32 chest scale)');
eq(normalizeSize('32x34').num, 32, '32x34 numeric');
eq(normalizeSize('10-12').cls, 'L', 'kids range 10-12 -> avg 11 -> L');
eq(normalizeSize('6.5').cls, 'S', 'shoe 6.5 -> S class');
eq(normalizeSize('OSFA').cls, 'OSFA', 'one size fits all');
eq(normalizeSize('size medium').cls, 'M', 'embedded word size');
eq(normalizeSize('').cls, '', 'empty size');
eq(normalizeSize('weird!!').cls, '', 'unparseable keeps raw only');

// ---------- money ----------
eq(toCents('$1,250.50'), 125050, 'money parse with $ and comma');
eq(toCents(49.99), 4999, 'numeric money');
eq(toCents(''), 0, 'empty money');
eq(toCents('free'), 0, 'non-numeric money');
eq(fmtMoney(125050), '$1,250.50', 'money format');

// ---------- colors ----------
eq(parseColors('Red / Gold, navy').join('|'), 'red|gold|navy', 'color splitting');
eq(parseColors(['Black']).join('|'), 'black', 'color array input');

// ---------- items CRUD + tag IDs ----------
const st = emptyState();
const a1 = addItem(st, { name: 'Victorian Ball Gown', category: 'dress', size: '10', colors: 'burgundy/gold', era: '1890s', gender: 'F', value: '250', room: 'Costume Loft', rack: 'Rack 3', bin: '' });
ok(a1.ok, 'addItem ok');
eq(a1.item.tagId, 'DR-0001', 'first dress tag DR-0001');
const a2 = addItem(st, { name: 'Victorian Day Dress', category: 'dress', size: '8', value: 120 });
eq(a2.item.tagId, 'DR-0002', 'second dress tag increments');
const a3 = addItem(st, { name: 'Top Hat', category: 'hat', value: 45, room: 'Costume Loft', rack: 'Shelf A' });
eq(a3.item.tagId, 'HT-0001', 'hat gets its own prefix sequence');
const dup = addItem(st, { name: 'Dup', category: 'dress', tagId: 'DR-0001' });
ok(!dup.ok, 'duplicate tagId rejected');
const noname = addItem(st, { name: '   ', category: 'prop' });
ok(!noname.ok, 'empty name rejected');
eq(nextTagId(st, 'dress'), 'DR-0003', 'nextTagId preview');
const manual = addItem(st, { name: 'Cane', category: 'prop', tagId: 'PROP-X1' });
eq(manual.item.tagId, 'PROP-X1', 'manual tag honored');
eq(locationLabel(a1.item), 'Costume Loft / Rack 3', 'location label skips empty bin');

const up = updateItem(st, a1.item.id, { value: '300', condition: 'fair', notes: 'hem repaired 2025' });
ok(up.ok, 'updateItem ok');
eq(a1.item.valueCents, 30000, 'value updated');
const upBad = updateItem(st, a1.item.id, { name: '' });
ok(!upBad.ok, 'update rejects empty name');
const upDupTag = updateItem(st, a2.item.id, { tagId: 'DR-0001' });
ok(!upDupTag.ok, 'update rejects duplicate tag');

// ---------- checkout ledger ----------
const co1 = checkOut(st, a1.item.id, { borrower: 'Maria Lopez', dueDate: '2026-07-01', date: '2026-06-20' });
ok(co1.ok, 'checkout ok');
const co1b = checkOut(st, a1.item.id, { borrower: 'Second Person' });
ok(!co1b.ok, 'double checkout blocked');
ok(openCheckoutFor(st, a1.item.id), 'open checkout visible');
eq(daysLate(co1.checkout, '2026-07-11'), 10, 'daysLate hand-computed: due Jul 1, asOf Jul 11 = 10');
eq(daysLate(co1.checkout, '2026-07-01'), 0, 'not late on due date');
eq(daysLate(co1.checkout, '2026-06-25'), 0, 'not late before due');

const co2 = checkOut(st, a3.item.id, { borrower: 'maria lopez', dueDate: '2026-07-05', date: '2026-06-22' });
ok(co2.ok, 'second checkout ok');
const od = overdue(st, '2026-07-11');
eq(od.length, 2, 'two overdue records');
eq(od[0].daysLate, 10, 'overdue sorted worst first');

const roll = borrowerRollup(st);
eq(roll.length, 1, 'case-insensitive borrower rollup merges Maria');
eq(roll[0].items.length, 2, 'Maria has 2 items');
eq(roll[0].valueCents, 30000 + 4500, 'Maria value rollup = $300 + $45');

const ci = checkIn(st, a3.item.id, { condition: 'needs repair', date: '2026-07-08', note: 'brim bent' });
ok(ci.ok, 'checkin ok');
eq(a3.item.condition, 'needs repair', 'return condition updates item');
eq(openCheckouts(st).length, 1, 'one checkout still open');
eq(historyFor(st, a3.item.id).length, 1, 'history retained after return');
const ciAgain = checkIn(st, a3.item.id, {});
ok(!ciAgain.ok, 'double checkin blocked');

const del = removeItem(st, a1.item.id);
ok(!del.ok, 'cannot delete checked-out item');

// retired items cannot check out
const retired = addItem(st, { name: 'Moth-eaten Cloak', category: 'accessory' });
updateItem(st, retired.item.id, { retired: true });
const coRet = checkOut(st, retired.item.id, { borrower: 'X' });
ok(!coRet.ok, 'retired item cannot be checked out');

// ---------- productions / pull sheet / plot / reconcile ----------
const p1 = addProduction(st, { name: 'Our Town', opens: '2026-10-01', closes: '2026-10-15' });
ok(p1.ok, 'addProduction ok');
const p2 = addProduction(st, { name: 'Cabaret', opens: '2026-10-10', closes: '2026-10-25' });
const p3 = addProduction(st, { name: 'Spring Musical', opens: '2027-03-01', closes: '2027-03-10' });

const as1 = assignItem(st, p1.production.id, a1.item.id, { character: 'Mrs. Gibbs', actor: 'Dana K.', scene: '2' });
ok(as1.ok, 'assign ok');
const as1dup = assignItem(st, p1.production.id, a1.item.id, {});
ok(!as1dup.ok, 'duplicate assignment blocked');
const as2 = assignItem(st, p1.production.id, a2.item.id, { character: 'Mrs. Gibbs', actor: 'Dana K.', scene: '1' });
const as3 = assignItem(st, p1.production.id, a3.item.id, { character: 'Doc Gibbs', actor: 'Sam R.', scene: '1' });
const as4 = assignItem(st, p1.production.id, manual.item.id, { character: 'Doc Gibbs', actor: 'Sam R.', scene: '3' });
ok(as2.ok && as3.ok && as4.ok, 'multiple assignments ok');
const asRet = assignItem(st, p1.production.id, retired.item.id, {});
ok(!asRet.ok, 'retired item cannot be assigned');

const sheet = pullSheet(st, p1.production.id);
eq(sheet.total, 4, 'pull sheet has 4 rows');
ok(sheet.groups.length >= 2, 'pull sheet grouped by location');
eq(sheet.groups[0].location < sheet.groups[sheet.groups.length - 1].location, true, 'pull sheet groups sorted by location');

const plot = costumePlot(st, p1.production.id);
eq(plot.length, 2, 'costume plot has 2 characters');
eq(plot[0].character, 'Doc Gibbs', 'plot sorted by character');
eq(plot[1].pieces[0].assignment.scene, '1', 'pieces in scene order');
eq(plot[1].pieces[1].assignment.scene, '2', 'scene 2 after scene 1');

// conflicts: a1 assigned to both Our Town and Cabaret (overlapping dates)
assignItem(st, p2.production.id, a1.item.id, { character: 'Sally', actor: 'J.' });
const conf = conflicts(st);
eq(conf.length, 1, 'one overlap conflict detected');
eq(conf[0].item.id, a1.item.id, 'conflict names the double-booked item');
// no conflict with far-future production
assignItem(st, p3.production.id, a3.item.id, {});
eq(conflicts(st).length, 1, 'non-overlapping production adds no conflict');
ok(rangesOverlap('2026-10-01', '2026-10-15', '2026-10-10', '2026-10-25'), 'ranges overlap true');
ok(!rangesOverlap('2026-10-01', '2026-10-15', '2027-03-01', '2027-03-10'), 'ranges overlap false');

// reconcile: mark two returned, one still assigned+checked out, one just unreturned
setAssignmentStatus(st, as2.assignment.id, 'returned');
setAssignmentStatus(st, as3.assignment.id, 'returned');
// a1 is still checked out to Maria under no production; re-checkout under production:
checkIn(st, a1.item.id, { date: '2026-07-09' });
checkOut(st, a1.item.id, { borrower: 'Dana K.', productionId: p1.production.id, date: '2026-10-01' });
const rec = reconcile(st, p1.production.id);
eq(rec.assignedCount, 4, 'reconcile sees 4 assignments');
eq(rec.missing.length, 2, 'two unreturned assignments');
eq(rec.missingValueCents, 30000 + 0, 'missing value = gown $300 + untagged cane $0');
const gownRow = rec.missing.find(m => m.item.id === a1.item.id);
ok(gownRow.stillCheckedOut, 'gown flagged still checked out');
eq(gownRow.borrower, 'Dana K.', 'reconcile names the borrower');

// unassign
const un = unassignItem(st, as4.assignment.id);
ok(un.ok, 'unassign ok');
eq(reconcile(st, p1.production.id).missing.length, 1, 'unassigned item leaves reconcile');

// production status
const stat = setProductionStatus(st, p1.production.id, 'closed');
ok(stat.ok, 'set status ok');
ok(!setProductionStatus(st, p1.production.id, 'bogus').ok, 'bogus status rejected');

// ---------- search ----------
const found = searchItems(st, { q: 'victorian gown' });
eq(found.length, 1, 'multi-token AND search');
eq(found[0].id, a1.item.id, 'search finds the gown');
eq(searchItems(st, { q: 'DR-0002' }).length, 1, 'search by tag id');
eq(searchItems(st, { category: 'hat' }).length, 1, 'category filter');
eq(searchItems(st, { sizeClass: 'M' }).length, 2, 'size class filter (dress 10 and dress 8 both -> M)');
eq(searchItems(st, { status: 'out' }).length, 1, 'status out filter');
eq(searchItems(st, { status: 'repair' }).length, 1, 'repair filter finds top hat');
eq(searchItems(st, { status: 'retired' }).length, 1, 'retired filter');
ok(!searchItems(st, {}).some(i => i.retired), 'default view hides retired');
eq(searchItems(st, { q: 'burgundy' }).length, 1, 'color token search');
eq(searchItems(st, { location: 'loft' }).length, 2, 'location filter case-insensitive');
eq(tokenize('  Red  GOWN ').join('|'), 'red|gown', 'tokenizer');

// ---------- stats ----------
const dash = dashboard(st, '2026-10-05');
eq(dash.itemCount, 4, 'dashboard active count excludes retired');
eq(dash.retiredCount, 1, 'retired count');
eq(dash.totalValueCents, 30000 + 12000 + 4500 + 0, 'total value hand-computed');
eq(dash.outCount, 1, 'one out');
eq(dash.outValueCents, 30000, 'value out the door');
eq(dash.repairList.length, 1, 'repair list');
eq(dash.byCategory.dress, 2, 'category breakdown');

// ---------- CSV ----------
const csvText = 'Item Name,Type,Size,Color,Replacement Cost,Room,Notes\n' +
  '"Flapper Dress, beaded",dress,8,"black, silver",85,Loft,"fragile, handle with care"\n' +
  'Fedora,hat,M,grey,25,Loft,\n' +
  ',,,,,\n' +
  'Pocket Watch,,,gold,40,Props Room,"engraved ""to J."""';
const rows = parseCSV(csvText);
eq(rows.length, 5, 'CSV parse row count (empty-fields row kept, import skips it)');
eq(rows[1][0], 'Flapper Dress, beaded', 'quoted comma preserved');
eq(rows[4][6], 'engraved "to J."', 'escaped quotes preserved');
const mapping = autoMapColumns(rows[0]);
eq(mapping.name, 0, 'auto-map name from "Item Name"');
eq(mapping.category, 1, 'auto-map category from "Type"');
eq(mapping.value, 4, 'auto-map value from "Replacement Cost"');
eq(mapping.room, 5, 'auto-map room');

const st2 = emptyState();
const imp = importRows(st2, rows);
eq(imp.imported, 3, 'import count');
eq(imp.skipped, 1, 'empty row skipped');
eq(st2.items[0].name, 'Flapper Dress, beaded', 'imported name');
eq(st2.items[0].valueCents, 8500, 'imported value cents');
eq(st2.items[2].category, 'prop', 'guessCategory: pocket watch -> prop');
eq(st2.items[1].category, 'hat', 'category text mapped');
eq(guessCategory('Victorian gown'), 'dress', 'guessCategory dress');
eq(guessCategory('cavalry saber'), 'other', 'guessCategory unknown -> other');
eq(guessCategory('leather boots'), 'shoes', 'guessCategory shoes');

const out = exportCSV(st2);
ok(out.includes('"Flapper Dress, beaded"'), 'export escapes comma names');
const reRows = parseCSV(out);
eq(reRows.length, 4, 'export roundtrip row count');
eq(reRows[1][1], 'Flapper Dress, beaded', 'roundtrip name intact');
eq(csvEscape('plain'), 'plain', 'no escape when clean');
eq(csvEscape('a"b'), '"a""b"', 'quote escaping');

// import with no name column
const bad = importRows(emptyState(), parseCSV('foo,bar\n1,2'));
ok(!bad.ok, 'import without name column fails loudly');

// ---------- license ----------
const key = mintKey('test-seed-1');
ok(key.startsWith('STAGECLOSET-'), 'key prefix');
ok(validateKey(key), 'minted key validates');
ok(validateKey(key.toLowerCase()), 'lowercase key validates');
ok(validateKey(key.replace(/0/g, 'O')), 'O/0 typo tolerated');
ok(validateKey(key.replace(/1/g, 'L')), 'L/1 typo tolerated');
ok(!validateKey('STAGECLOSET-AAAA-BBBB-CCCC'), 'forged key rejected');
ok(!validateKey(''), 'empty key rejected');
ok(!validateKey('TELLSCAN-1234-5678-9ABC'), 'wrong product key rejected');
const key2 = mintKey('test-seed-2');
ok(key !== key2, 'distinct seeds distinct keys');
ok(validateKey(' ' + key.replace(/-/g, ' ') + ' '), 'whitespace/dash variants tolerated');
eq(normalizeKey('OIL'), '011', 'normalizeKey maps O->0, I/L->1');

// ---------- vault ----------
const vaultText = serializeVault(st);
const parsed = parseVault(vaultText);
ok(parsed.ok, 'vault parses');
eq(parsed.state.items.length, st.items.length, 'vault item count');
eq(parsed.state.checkouts.length, st.checkouts.length, 'vault checkout count');
eq(parsed.state.productions.length, 3, 'vault production count');
ok(!parseVault('{"nope":1}').ok, 'foreign JSON rejected');
ok(!parseVault('garbage').ok, 'garbage rejected');
const newer = JSON.stringify({ format: 'stagecloset-vault', version: 99, data: {} });
ok(!parseVault(newer).ok, 'newer version rejected with message');
// integrity: orphan checkout dropped
const orphan = JSON.parse(vaultText);
orphan.data.checkouts.push({ id: 'co_x', itemId: 'it_missing', borrower: 'ghost' });
const parsed2 = parseVault(JSON.stringify(orphan));
eq(parsed2.state.checkouts.length, st.checkouts.length, 'orphan checkout dropped on import');

// ---------- summary ----------
console.log('\nStageCloset tests: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
