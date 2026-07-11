// StageCloset UI. All data stays in this browser: state in localStorage,
// photos in IndexedDB. No network calls anywhere in this file.

import {
  emptyState, addItem, updateItem, removeItem, CATEGORIES, CONDITIONS,
  categoryById, fmtMoney, locationLabel, toCents
} from './engine/items.js';
import {
  checkOut, checkIn, openCheckoutFor, openCheckouts, historyFor,
  daysLate, overdue, borrowerRollup, todayISO
} from './engine/checkout.js';
import {
  addProduction, setProductionStatus, assignItem, setAssignmentStatus,
  unassignItem, assignmentsFor, pullSheet, costumePlot, reconcile, conflicts
} from './engine/productions.js';
import { searchItems } from './engine/search.js';
import { dashboard } from './engine/stats.js';
import { parseCSV, importRows, exportCSV } from './engine/csvio.js';
import { validateKey } from './engine/license.js';
import { serializeVault, parseVault } from './engine/vault.js';

var BUY_URL = 'https://payhip.com/b/V9k6A';
var FREE_ITEM_LIMIT = 150;
var FREE_PROD_LIMIT = 1;
var LS_STATE = 'stagecloset.state.v1';
var LS_LICENSE = 'stagecloset.license';

var state = loadState();
var isPro = validateKey(localStorage.getItem(LS_LICENSE) || '');
var filters = { q: '', category: '', sizeClass: '', status: '', condition: '' };
var currentProdId = null;
var urlCache = new Map(); // photoId -> objectURL

// ---------- persistence ----------
function loadState() {
  try {
    var raw = localStorage.getItem(LS_STATE);
    if (raw) {
      var v = parseVault(raw);
      if (v.ok) return v.state;
      var plain = JSON.parse(raw);
      if (plain && Array.isArray(plain.items)) return plain;
    }
  } catch (e) { /* fall through to fresh state */ }
  return emptyState();
}
function save() {
  localStorage.setItem(LS_STATE, serializeVault(state));
  renderAll();
}

// ---------- IndexedDB photos ----------
var dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise(function (res, rej) {
      var req = indexedDB.open('stagecloset-photos', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('photos'); };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
  }
  return dbPromise;
}
function photoPut(id, blob) {
  return db().then(function (d) {
    return new Promise(function (res, rej) {
      var tx = d.transaction('photos', 'readwrite');
      tx.objectStore('photos').put(blob, id);
      tx.oncomplete = res; tx.onerror = function () { rej(tx.error); };
    });
  });
}
function photoGet(id) {
  return db().then(function (d) {
    return new Promise(function (res) {
      var req = d.transaction('photos').objectStore('photos').get(id);
      req.onsuccess = function () { res(req.result || null); };
      req.onerror = function () { res(null); };
    });
  });
}
function photoDel(id) {
  return db().then(function (d) {
    return new Promise(function (res) {
      var tx = d.transaction('photos', 'readwrite');
      tx.objectStore('photos').delete(id);
      tx.oncomplete = res; tx.onerror = res;
    });
  });
}
function photoURL(id) {
  if (urlCache.has(id)) return Promise.resolve(urlCache.get(id));
  return photoGet(id).then(function (blob) {
    if (!blob) return null;
    var u = URL.createObjectURL(blob);
    urlCache.set(id, u);
    return u;
  });
}
function downscale(file) {
  return new Promise(function (res, rej) {
    var img = new Image();
    var fr = new FileReader();
    fr.onload = function () { img.src = fr.result; };
    fr.onerror = rej;
    img.onload = function () {
      var max = 700;
      var scale = Math.min(1, max / Math.max(img.width, img.height));
      var c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(function (b) { b ? res(b) : rej(new Error('encode failed')); }, 'image/jpeg', 0.82);
    };
    img.onerror = rej;
    fr.readAsDataURL(file);
  });
}

// ---------- helpers ----------
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function el(id) { return document.getElementById(id); }
function download(filename, text, mime) {
  var blob = new Blob([text], { type: mime || 'text/plain' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
}
function catLabel(id) { return categoryById(id).label; }
function activeProductions() { return state.productions.filter(function (p) { return p.status !== 'closed'; }); }

function itemStatusChip(item) {
  if (item.retired) return '<span class="chip retired">retired</span>';
  var open = openCheckoutFor(state, item.id);
  if (open) {
    var late = daysLate(open, todayISO());
    if (late > 0) return '<span class="chip overdue">OUT ' + late + 'd late</span>';
    return '<span class="chip out">OUT: ' + esc(open.borrower) + '</span>';
  }
  if (item.condition === 'needs repair') return '<span class="chip repair">repair</span>';
  return '<span class="chip in">in</span>';
}

// ---------- modal ----------
function openModal(html) {
  el('modalBox').innerHTML = '<button class="x" id="modalClose">&times;</button>' + html;
  el('modalBack').classList.add('open');
  el('modalClose').onclick = closeModal;
  return el('modalBox');
}
function closeModal() { el('modalBack').classList.remove('open'); }
el('modalBack').addEventListener('click', function (e) { if (e.target === el('modalBack')) closeModal(); });

function upgradeModal(why) {
  var box = openModal(
    '<h2>StageCloset Pro</h2>' +
    '<p>' + esc(why) + '</p>' +
    '<ul style="margin:10px 0 10px 20px; line-height:1.9">' +
    '<li><b>Unlimited items</b> (free plan: ' + FREE_ITEM_LIMIT + ')</li>' +
    '<li><b>Unlimited productions</b> (free plan: ' + FREE_PROD_LIMIT + ' active)</li>' +
    '<li><b>Print pack</b>: pull sheets by rack, costume plots, tag label sheets</li>' +
    '<li><b>Strike report</b>: every unreturned piece after a show, with dollar values and names</li>' +
    '</ul>' +
    '<p class="muted">One-time purchase. No subscription, no account. The key works offline forever.</p>' +
    '<div class="row" style="margin-top:14px">' +
    '<a href="' + BUY_URL + '" target="_blank" rel="noopener"><button class="btn gold">Get Pro ($29 one time)</button></a>' +
    '</div>' +
    '<h3>Already have a key?</h3>' +
    '<div class="row"><input id="licInput" class="grow" placeholder="STAGECLOSET-XXXX-XXXX-XXXX">' +
    '<button class="btn" id="licApply">Activate</button></div>' +
    '<p class="muted" id="licMsg"></p>'
  );
  box.querySelector('#licApply').onclick = function () {
    var v = box.querySelector('#licInput').value;
    if (validateKey(v)) {
      localStorage.setItem(LS_LICENSE, v.trim());
      isPro = true;
      closeModal();
      renderAll();
    } else {
      box.querySelector('#licMsg').textContent = 'That key does not validate. Check for typos and try again.';
    }
  };
}

// ---------- item modal ----------
function itemModal(itemId) {
  var item = state.items.find(function (i) { return i.id === itemId; });
  if (!item) return;
  var open = openCheckoutFor(state, item.id);
  var hist = historyFor(state, item.id);
  var catOpts = CATEGORIES.map(function (c) {
    return '<option value="' + c.id + '"' + (item.category === c.id ? ' selected' : '') + '>' + esc(c.label) + '</option>';
  }).join('');
  var condOpts = CONDITIONS.filter(function (c) { return c !== 'retired'; }).map(function (c) {
    return '<option' + (item.condition === c ? ' selected' : '') + '>' + c + '</option>';
  }).join('');
  var prodOpts = activeProductions().map(function (p) {
    return '<option value="' + p.id + '">' + esc(p.name) + '</option>';
  }).join('');

  var html =
    '<h2>' + esc(item.tagId) + ' · ' + esc(item.name) + '</h2>' +
    '<div class="photo-strip" id="imPhotos"></div>' +
    '<div class="row"><label class="btn ghost small" style="cursor:pointer">Add photo' +
    '<input type="file" accept="image/*" id="imPhotoIn" style="display:none" multiple></label>' +
    '<span class="muted">Photos stay on this device.</span></div>' +
    '<h3>Details</h3>' +
    '<div class="row">' +
    '<div class="field"><label class="f">Name</label><input id="imName" value="' + esc(item.name) + '"></div>' +
    '<div class="field"><label class="f">Tag ID</label><input id="imTag" value="' + esc(item.tagId) + '"></div>' +
    '<div class="field"><label class="f">Category</label><select id="imCat">' + catOpts + '</select></div>' +
    '</div><div class="row">' +
    '<div class="field small"><label class="f">Size</label><input id="imSize" value="' + esc(item.size.raw) + '"></div>' +
    '<div class="field small"><label class="f">Era</label><input id="imEra" value="' + esc(item.era) + '"></div>' +
    '<div class="field small"><label class="f">Colors</label><input id="imColors" value="' + esc(item.colors.join(', ')) + '"></div>' +
    '<div class="field small"><label class="f">Gender</label><select id="imGender">' +
    ['', 'F', 'M', 'U'].map(function (g) { return '<option' + (item.gender === g ? ' selected' : '') + '>' + g + '</option>'; }).join('') +
    '</select></div>' +
    '<div class="field small"><label class="f">Condition</label><select id="imCond">' + condOpts + '</select></div>' +
    '</div><div class="row">' +
    '<div class="field small"><label class="f">Room</label><input id="imRoom" value="' + esc(item.location.room) + '"></div>' +
    '<div class="field small"><label class="f">Rack / shelf</label><input id="imRack" value="' + esc(item.location.rack) + '"></div>' +
    '<div class="field small"><label class="f">Bin / box</label><input id="imBin" value="' + esc(item.location.bin) + '"></div>' +
    '<div class="field small"><label class="f">Value ($)</label><input id="imValue" value="' + (item.valueCents / 100).toFixed(2) + '"></div>' +
    '</div>' +
    '<div class="row"><div class="grow"><label class="f">Notes</label><textarea id="imNotes" rows="2">' + esc(item.notes) + '</textarea></div></div>' +
    '<div class="row" style="margin-top:10px">' +
    '<button class="btn" id="imSave">Save changes</button>' +
    (open
      ? '<button class="btn gold" id="imCheckin">Check in</button>'
      : '<button class="btn gold" id="imCheckout">Check out</button>') +
    (prodOpts && !item.retired ? '<select id="imProdSel" style="max-width:200px"><option value="">Add to pull list...</option>' + prodOpts + '</select>' : '') +
    '<span class="right"></span>' +
    '<button class="btn ghost small" id="imRetire">' + (item.retired ? 'Unretire' : 'Retire') + '</button>' +
    '<button class="btn danger small" id="imDelete">Delete</button>' +
    '</div>' +
    '<p class="muted" id="imMsg"></p>' +
    (open ? '<div class="notice warn">Checked out to <b>' + esc(open.borrower) + '</b> on ' + esc(open.checkedOutAt) +
      (open.dueDate ? ', due ' + esc(open.dueDate) : '') + (open.note ? ' · ' + esc(open.note) : '') + '</div>' : '') +
    '<h3>History</h3>' +
    (hist.length
      ? '<div class="table-scroll"><table class="grid"><tr><th>Out</th><th>Borrower</th><th>Due</th><th>Returned</th><th>Condition</th></tr>' +
      hist.map(function (h) {
        return '<tr><td>' + esc(h.checkedOutAt) + '</td><td>' + esc(h.borrower) + '</td><td>' + esc(h.dueDate || '') +
          '</td><td>' + esc(h.returnedAt || 'still out') + '</td><td>' + esc(h.returnCondition || '') + '</td></tr>';
      }).join('') + '</table></div>'
      : '<p class="muted">Never checked out.</p>');

  var box = openModal(html);
  renderItemPhotos(box, item);

  box.querySelector('#imPhotoIn').onchange = function (e) {
    var files = Array.from(e.target.files || []);
    var chain = Promise.resolve();
    files.slice(0, 3 - item.photoIds.length).forEach(function (f) {
      chain = chain.then(function () {
        return downscale(f).then(function (blob) {
          var pid = 'ph_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
          return photoPut(pid, blob).then(function () { item.photoIds.push(pid); });
        });
      });
    });
    chain.then(function () { save(); itemModal(itemId); });
  };

  box.querySelector('#imSave').onclick = function () {
    var res = updateItem(state, item.id, {
      name: box.querySelector('#imName').value,
      tagId: box.querySelector('#imTag').value,
      category: box.querySelector('#imCat').value,
      size: box.querySelector('#imSize').value,
      era: box.querySelector('#imEra').value,
      colors: box.querySelector('#imColors').value,
      gender: box.querySelector('#imGender').value,
      condition: box.querySelector('#imCond').value,
      room: box.querySelector('#imRoom').value,
      rack: box.querySelector('#imRack').value,
      bin: box.querySelector('#imBin').value,
      value: box.querySelector('#imValue').value,
      notes: box.querySelector('#imNotes').value
    });
    if (!res.ok) { box.querySelector('#imMsg').textContent = res.errors.join(' '); return; }
    save(); closeModal();
  };

  var co = box.querySelector('#imCheckout');
  if (co) co.onclick = function () { closeModal(); checkoutModal(item.id); };
  var ci = box.querySelector('#imCheckin');
  if (ci) ci.onclick = function () { closeModal(); checkinModal(item.id); };

  var ps = box.querySelector('#imProdSel');
  if (ps) ps.onchange = function () {
    if (!ps.value) return;
    var res = assignItem(state, ps.value, item.id, {});
    box.querySelector('#imMsg').textContent = res.ok ? 'Added to pull list.' : res.errors.join(' ');
    if (res.ok) save();
  };

  box.querySelector('#imRetire').onclick = function () {
    updateItem(state, item.id, { retired: !item.retired });
    save(); closeModal();
  };
  box.querySelector('#imDelete').onclick = function () {
    if (!confirm('Delete "' + item.name + '" and its history? This cannot be undone.')) return;
    var res = removeItem(state, item.id);
    if (!res.ok) { box.querySelector('#imMsg').textContent = res.errors.join(' '); return; }
    item.photoIds.forEach(photoDel);
    save(); closeModal();
  };
}

function renderItemPhotos(box, item) {
  var strip = box.querySelector('#imPhotos');
  if (!strip) return;
  strip.innerHTML = '';
  item.photoIds.forEach(function (pid) {
    photoURL(pid).then(function (u) {
      if (!u) return;
      var wrap = document.createElement('div');
      wrap.className = 'photo-wrap';
      wrap.innerHTML = '<img src="' + u + '" alt=""><button title="Remove photo">&times;</button>';
      wrap.querySelector('button').onclick = function () {
        item.photoIds = item.photoIds.filter(function (x) { return x !== pid; });
        photoDel(pid); urlCache.delete(pid);
        save(); itemModal(item.id);
      };
      strip.appendChild(wrap);
    });
  });
}

function checkoutModal(itemId) {
  var item = state.items.find(function (i) { return i.id === itemId; });
  var prodOpts = activeProductions().map(function (p) {
    return '<option value="' + p.id + '">' + esc(p.name) + '</option>';
  }).join('');
  var box = openModal(
    '<h2>Check out: ' + esc(item.name) + '</h2>' +
    '<div class="row">' +
    '<div class="field"><label class="f">Borrower *</label><input id="coName" placeholder="Actor, teacher, other troupe..."></div>' +
    '<div class="field"><label class="f">Contact</label><input id="coContact" placeholder="phone or email"></div>' +
    '</div><div class="row">' +
    '<div class="field small"><label class="f">Due back</label><input id="coDue" type="date"></div>' +
    (prodOpts ? '<div class="field"><label class="f">For production</label><select id="coProd"><option value="">(none)</option>' + prodOpts + '</select></div>' : '') +
    '<div class="field"><label class="f">Note</label><input id="coNote"></div>' +
    '</div>' +
    '<div class="row" style="margin-top:12px"><button class="btn gold" id="coGo">Check out</button><span class="muted" id="coMsg"></span></div>'
  );
  box.querySelector('#coGo').onclick = function () {
    var res = checkOut(state, itemId, {
      borrower: box.querySelector('#coName').value,
      contact: box.querySelector('#coContact').value,
      dueDate: box.querySelector('#coDue').value,
      productionId: (box.querySelector('#coProd') || {}).value || null,
      note: box.querySelector('#coNote').value
    });
    if (!res.ok) { box.querySelector('#coMsg').textContent = res.errors.join(' '); return; }
    save(); closeModal();
  };
}

function checkinModal(itemId) {
  var item = state.items.find(function (i) { return i.id === itemId; });
  var open = openCheckoutFor(state, itemId);
  var box = openModal(
    '<h2>Check in: ' + esc(item.name) + '</h2>' +
    '<p class="muted">Out to ' + esc(open ? open.borrower : '?') + ' since ' + esc(open ? open.checkedOutAt : '') + '.</p>' +
    '<div class="row">' +
    '<div class="field"><label class="f">Condition on return</label><select id="ciCond"><option value="">(unchanged)</option>' +
    ['new', 'good', 'fair', 'needs repair'].map(function (c) { return '<option>' + c + '</option>'; }).join('') + '</select></div>' +
    '<div class="field"><label class="f">Note</label><input id="ciNote" placeholder="hem torn, cleaned, etc."></div>' +
    '</div>' +
    '<div class="row" style="margin-top:12px"><button class="btn gold" id="ciGo">Check in</button></div>'
  );
  box.querySelector('#ciGo').onclick = function () {
    checkIn(state, itemId, {
      condition: box.querySelector('#ciCond').value,
      note: box.querySelector('#ciNote').value
    });
    save(); closeModal();
  };
}

// ---------- closet pane ----------
function renderCloset() {
  var pane = el('pane-closet');
  var catOpts = '<option value="">All categories</option>' + CATEGORIES.map(function (c) {
    return '<option value="' + c.id + '"' + (filters.category === c.id ? ' selected' : '') + '>' + esc(c.label) + '</option>';
  }).join('');
  var sizeOpts = '<option value="">Any size</option>' + ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'OSFA'].map(function (s) {
    return '<option' + (filters.sizeClass === s ? ' selected' : '') + '>' + s + '</option>';
  }).join('');
  var statusOpts = '<option value="">All statuses</option>' +
    [['in', 'In stock'], ['out', 'Checked out'], ['repair', 'Needs repair'], ['retired', 'Retired']].map(function (p) {
      return '<option value="' + p[0] + '"' + (filters.status === p[0] ? ' selected' : '') + '>' + p[1] + '</option>';
    }).join('');

  var results = searchItems(state, filters);
  var atLimit = !isPro && state.items.length >= FREE_ITEM_LIMIT;

  pane.innerHTML =
    '<div class="panel"><div class="row">' +
    '<input id="fQ" class="grow" placeholder="Search: victorian gown, DR-0012, red 42R, rack 3..." value="' + esc(filters.q) + '">' +
    '<select id="fCat" style="max-width:170px">' + catOpts + '</select>' +
    '<select id="fSize" style="max-width:110px">' + sizeOpts + '</select>' +
    '<select id="fStatus" style="max-width:140px">' + statusOpts + '</select>' +
    '<button class="btn" id="addBtn">+ Add item</button>' +
    '</div></div>' +
    (atLimit ? '<div class="notice warn">Free plan holds ' + FREE_ITEM_LIMIT + ' items and you are at ' + state.items.length +
      '. <a href="#" id="limitUp">Go Pro for unlimited items</a>, one time, no subscription.</div>' : '') +
    (state.items.length === 0
      ? '<div class="panel"><h2>Empty closet</h2>' +
        '<p>Three ways to start:</p>' +
        '<ol style="margin:8px 0 12px 22px; line-height: 2">' +
        '<li><b>Add item</b> above, one piece at a time (fastest with a phone in the storage room).</li>' +
        '<li><b>Import your spreadsheet</b> in the Import / Backup tab. Columns are auto-detected.</li>' +
        '<li><b>Load the sample closet</b> to poke around first: <button class="btn ghost small" id="demoBtn">Load sample closet</button></li>' +
        '</ol>' +
        '<p class="muted">Everything stays in this browser. No account, no upload, works with the WiFi down.</p></div>'
      : '<div class="panel"><div class="table-scroll"><table class="grid"><tr>' +
        '<th></th><th>Tag</th><th>Name</th><th>Category</th><th>Size</th><th>Location</th><th class="num">Value</th><th>Status</th></tr>' +
        results.slice(0, 400).map(function (i) {
          return '<tr data-id="' + i.id + '" style="cursor:pointer">' +
            '<td><div class="thumb ph" data-ph="' + (i.photoIds[0] || '') + '">&#128444;</div></td>' +
            '<td><b>' + esc(i.tagId) + '</b></td>' +
            '<td>' + esc(i.name) + (i.era ? ' <span class="muted">(' + esc(i.era) + ')</span>' : '') + '</td>' +
            '<td>' + esc(catLabel(i.category)) + '</td>' +
            '<td>' + esc(i.size.raw) + (i.size.cls && i.size.cls !== i.size.raw ? ' <span class="muted">' + i.size.cls + '</span>' : '') + '</td>' +
            '<td>' + esc(locationLabel(i)) + '</td>' +
            '<td class="num">' + (i.valueCents ? fmtMoney(i.valueCents) : '') + '</td>' +
            '<td>' + itemStatusChip(i) + '</td></tr>';
        }).join('') +
        '</table></div>' +
        '<p class="muted" style="margin-top:8px">' + results.length + ' of ' + state.items.length + ' items' +
        (results.length > 400 ? ' (showing first 400, narrow the search)' : '') + '.' +
        (isPro ? ' <a href="#" id="printTags">Print tag labels for these ' + results.length + '</a>' : '') +
        '</p></div>');

  el('fQ').oninput = function () { filters.q = this.value; renderCloset(); };
  el('fCat').onchange = function () { filters.category = this.value; renderCloset(); };
  el('fSize').onchange = function () { filters.sizeClass = this.value; renderCloset(); };
  el('fStatus').onchange = function () { filters.status = this.value; renderCloset(); };
  el('addBtn').onclick = function () {
    if (!isPro && state.items.length >= FREE_ITEM_LIMIT) { upgradeModal('The free plan holds ' + FREE_ITEM_LIMIT + ' items.'); return; }
    addItemModal();
  };
  var d = el('demoBtn'); if (d) d.onclick = loadSample;
  var lu = el('limitUp'); if (lu) lu.onclick = function (e) { e.preventDefault(); upgradeModal('The free plan holds ' + FREE_ITEM_LIMIT + ' items.'); };
  var pt = el('printTags'); if (pt) pt.onclick = function (e) { e.preventDefault(); printTags(results); };

  pane.querySelectorAll('tr[data-id]').forEach(function (tr) {
    tr.onclick = function () { itemModal(tr.getAttribute('data-id')); };
  });
  pane.querySelectorAll('.thumb[data-ph]').forEach(function (t) {
    var pid = t.getAttribute('data-ph');
    if (!pid) return;
    photoURL(pid).then(function (u) {
      if (u) t.outerHTML = '<img class="thumb" src="' + u + '" alt="">';
    });
  });
}

function addItemModal() {
  var catOpts = CATEGORIES.map(function (c) { return '<option value="' + c.id + '">' + esc(c.label) + '</option>'; }).join('');
  var box = openModal(
    '<h2>Add item</h2>' +
    '<div class="row">' +
    '<div class="field"><label class="f">Name *</label><input id="aiName" placeholder="Victorian ball gown"></div>' +
    '<div class="field"><label class="f">Category</label><select id="aiCat">' + catOpts + '</select></div>' +
    '</div><div class="row">' +
    '<div class="field small"><label class="f">Size</label><input id="aiSize" placeholder="10, 42R, M..."></div>' +
    '<div class="field small"><label class="f">Era</label><input id="aiEra" placeholder="1920s"></div>' +
    '<div class="field small"><label class="f">Colors</label><input id="aiColors" placeholder="red, gold"></div>' +
    '<div class="field small"><label class="f">Value ($)</label><input id="aiValue" placeholder="0"></div>' +
    '</div><div class="row">' +
    '<div class="field small"><label class="f">Room</label><input id="aiRoom" placeholder="Costume loft"></div>' +
    '<div class="field small"><label class="f">Rack / shelf</label><input id="aiRack" placeholder="Rack 3"></div>' +
    '<div class="field small"><label class="f">Bin / box</label><input id="aiBin"></div>' +
    '</div>' +
    '<div class="row"><div class="grow"><label class="f">Notes</label><input id="aiNotes"></div></div>' +
    '<div class="row" style="margin-top:12px"><button class="btn gold" id="aiGo">Add to closet</button>' +
    '<label style="font-size:13px; color:var(--muslin-dim)"><input type="checkbox" id="aiAgain" checked style="width:auto; margin-right:4px">Keep adding</label>' +
    '<span class="muted" id="aiMsg"></span></div>'
  );
  box.querySelector('#aiName').focus();
  box.querySelector('#aiGo').onclick = function () {
    var res = addItem(state, {
      name: box.querySelector('#aiName').value,
      category: box.querySelector('#aiCat').value,
      size: box.querySelector('#aiSize').value,
      era: box.querySelector('#aiEra').value,
      colors: box.querySelector('#aiColors').value,
      value: box.querySelector('#aiValue').value,
      room: box.querySelector('#aiRoom').value,
      rack: box.querySelector('#aiRack').value,
      bin: box.querySelector('#aiBin').value,
      notes: box.querySelector('#aiNotes').value
    });
    if (!res.ok) { box.querySelector('#aiMsg').textContent = res.errors.join(' '); return; }
    localStorage.setItem(LS_STATE, serializeVault(state));
    box.querySelector('#aiMsg').textContent = 'Added ' + res.item.tagId + '.';
    if (box.querySelector('#aiAgain').checked) {
      ['aiName', 'aiSize', 'aiColors', 'aiValue', 'aiNotes'].forEach(function (id) { box.querySelector('#' + id).value = ''; });
      box.querySelector('#aiName').focus();
      renderAllExceptModal();
    } else { save(); closeModal(); }
  };
}
function renderAllExceptModal() {
  renderCloset(); renderCheckout(); renderProductions(); renderDashboard(); renderVault(); renderChrome();
}

// ---------- checkout pane ----------
function renderCheckout() {
  var pane = el('pane-checkout');
  var open = openCheckouts(state);
  var od = overdue(state, todayISO());
  var roll = borrowerRollup(state);

  pane.innerHTML =
    '<h2>Out right now</h2>' +
    (open.length === 0 ? '<div class="panel"><p class="muted">Nothing is checked out. The closet is whole.</p></div>' :
      '<div class="panel"><div class="table-scroll"><table class="grid"><tr>' +
      '<th>Tag</th><th>Item</th><th>Borrower</th><th>Out since</th><th>Due</th><th class="num">Value</th><th></th></tr>' +
      open.map(function (c) {
        var item = state.items.find(function (i) { return i.id === c.itemId; });
        var late = daysLate(c, todayISO());
        return '<tr><td><b>' + esc(item ? item.tagId : '?') + '</b></td>' +
          '<td>' + esc(item ? item.name : '(deleted)') + '</td>' +
          '<td>' + esc(c.borrower) + (c.contact ? ' <span class="muted">' + esc(c.contact) + '</span>' : '') + '</td>' +
          '<td>' + esc(c.checkedOutAt) + '</td>' +
          '<td>' + (c.dueDate ? esc(c.dueDate) : '<span class="muted">no date</span>') +
          (late ? ' <span class="chip overdue">' + late + 'd late</span>' : '') + '</td>' +
          '<td class="num">' + (item && item.valueCents ? fmtMoney(item.valueCents) : '') + '</td>' +
          '<td><button class="btn small" data-ci="' + c.itemId + '">Check in</button></td></tr>';
      }).join('') + '</table></div></div>') +
    (od.length ? '<div class="notice bad"><b>' + od.length + ' overdue.</b> Worst: ' +
      esc((state.items.find(function (i) { return i.id === od[0].checkout.itemId; }) || {}).name || '') +
      ', ' + od[0].daysLate + ' days late with ' + esc(od[0].checkout.borrower) + '.</div>' : '') +
    '<h2 style="margin-top:20px">Who has what</h2>' +
    (roll.length === 0 ? '<p class="muted">Nobody has anything.</p>' :
      '<div class="tiles">' + roll.slice(0, 8).map(function (r) {
        return '<div class="tile"><div class="v' + (r.valueCents >= 10000 ? ' bad' : '') + '">' + fmtMoney(r.valueCents) + '</div>' +
          '<div class="k">' + esc(r.borrower) + ' · ' + r.items.length + ' item' + (r.items.length === 1 ? '' : 's') + '</div></div>';
      }).join('') + '</div>');

  pane.querySelectorAll('[data-ci]').forEach(function (b) {
    b.onclick = function () { checkinModal(b.getAttribute('data-ci')); };
  });
}

// ---------- productions pane ----------
function renderProductions() {
  var pane = el('pane-productions');
  var conf = conflicts(state);
  var listHtml = state.productions.length === 0
    ? '<p class="muted">No productions yet. A production gets a pull list, a costume plot, and a strike report.</p>'
    : '<div class="table-scroll"><table class="grid"><tr><th>Production</th><th>Dates</th><th>Status</th><th>Pieces</th><th></th></tr>' +
      state.productions.map(function (p) {
        var n = assignmentsFor(state, p.id).length;
        return '<tr><td><b>' + esc(p.name) + '</b></td>' +
          '<td>' + esc(p.opens || '?') + ' to ' + esc(p.closes || '?') + '</td>' +
          '<td><span class="chip' + (p.status === 'running' ? ' gold' : '') + '">' + p.status + '</span></td>' +
          '<td>' + n + '</td>' +
          '<td><button class="btn small ghost" data-open="' + p.id + '">Open</button></td></tr>';
      }).join('') + '</table></div>';

  var prodView = '';
  if (currentProdId) {
    var p = state.productions.find(function (x) { return x.id === currentProdId; });
    if (p) prodView = productionView(p, conf);
  }

  pane.innerHTML =
    '<div class="panel"><div class="row"><h2 style="margin:0">Productions</h2>' +
    '<button class="btn right" id="addProd">+ New production</button></div>' +
    (conf.length ? '<div class="notice warn"><b>Double-booked:</b> ' + conf.map(function (c) {
      return esc(c.item.tagId) + ' ' + esc(c.item.name) + ' (' + c.productions.map(function (x) { return esc(x.name); }).join(' + ') + ')';
    }).join('; ') + '</div>' : '') +
    listHtml + '</div>' + prodView;

  el('addProd').onclick = function () {
    if (!isPro && activeProductions().length >= FREE_PROD_LIMIT) {
      upgradeModal('The free plan runs ' + FREE_PROD_LIMIT + ' production at a time.');
      return;
    }
    var box = openModal(
      '<h2>New production</h2>' +
      '<div class="row"><div class="field"><label class="f">Name *</label><input id="npName" placeholder="Our Town"></div></div>' +
      '<div class="row"><div class="field small"><label class="f">Opens</label><input id="npOpen" type="date"></div>' +
      '<div class="field small"><label class="f">Closes</label><input id="npClose" type="date"></div></div>' +
      '<div class="row" style="margin-top:12px"><button class="btn gold" id="npGo">Create</button><span class="muted" id="npMsg"></span></div>'
    );
    box.querySelector('#npGo').onclick = function () {
      var res = addProduction(state, {
        name: box.querySelector('#npName').value,
        opens: box.querySelector('#npOpen').value,
        closes: box.querySelector('#npClose').value
      });
      if (!res.ok) { box.querySelector('#npMsg').textContent = res.errors.join(' '); return; }
      currentProdId = res.production.id;
      save(); closeModal();
    };
  };
  pane.querySelectorAll('[data-open]').forEach(function (b) {
    b.onclick = function () { currentProdId = b.getAttribute('data-open'); renderProductions(); };
  });
  if (currentProdId) wireProductionView(pane);
}

function productionView(p, conf) {
  var rows = assignmentsFor(state, p.id);
  var sheet = pullSheet(state, p.id);
  var rec = reconcile(state, p.id);
  var statusBtns = ['planning', 'running', 'closed'].map(function (s) {
    return '<button class="btn small ' + (p.status === s ? 'gold' : 'ghost') + '" data-status="' + s + '">' + s + '</button>';
  }).join(' ');

  return '<div class="panel">' +
    '<div class="row"><h2 style="margin:0">' + esc(p.name) + '</h2><span class="muted">' + esc(p.opens || '') + (p.closes ? ' to ' + esc(p.closes) : '') + '</span>' +
    '<span class="right"></span>' + statusBtns + '</div>' +
    '<h3>Pull list (' + rows.length + ' pieces)</h3>' +
    '<div class="row"><input id="plSearch" class="grow" placeholder="Type to find a piece to add: gown, DR-0012, top hat..."><div id="plResults"></div></div>' +
    '<div id="plMatches"></div>' +
    (rows.length ? '<div class="table-scroll" style="margin-top:10px"><table class="grid"><tr>' +
      '<th>Tag</th><th>Item</th><th>Character</th><th>Actor</th><th>Scene</th><th>Status</th><th></th></tr>' +
      rows.map(function (a) {
        var item = state.items.find(function (i) { return i.id === a.itemId; });
        return '<tr><td><b>' + esc(item ? item.tagId : '?') + '</b></td><td>' + esc(item ? item.name : '(deleted)') + '</td>' +
          '<td><input data-af="character" data-aid="' + a.id + '" value="' + esc(a.character) + '" style="min-width:90px"></td>' +
          '<td><input data-af="actor" data-aid="' + a.id + '" value="' + esc(a.actor) + '" style="min-width:90px"></td>' +
          '<td><input data-af="scene" data-aid="' + a.id + '" value="' + esc(a.scene) + '" style="width:60px"></td>' +
          '<td><button class="btn small ghost" data-cycle="' + a.id + '">' + a.status + '</button></td>' +
          '<td><button class="btn small danger" data-unassign="' + a.id + '">&times;</button></td></tr>';
      }).join('') + '</table></div>' : '<p class="muted">Nothing on the pull list yet.</p>') +
    '<div class="row" style="margin-top:12px">' +
    (isPro
      ? '<button class="btn" id="printPull">Print pull sheet (by rack)</button>' +
        '<button class="btn" id="printPlot">Print costume plot</button>' +
        '<button class="btn ghost" id="printStrike">Strike report</button>'
      : '<div class="locked" style="flex:1"><b>Pro print pack:</b> pull sheet grouped by rack for pull day, per-character costume plot, ' +
        'and the strike report that lists every unreturned piece with dollar values (' + rec.missing.length + ' unreturned right now, ' +
        fmtMoney(rec.missingValueCents) + ' at risk). <a href="#" id="lockUp">Unlock with Pro</a>.</div>') +
    '</div></div>';
}

function wireProductionView(pane) {
  var p = state.productions.find(function (x) { return x.id === currentProdId; });
  if (!p) return;
  pane.querySelectorAll('[data-status]').forEach(function (b) {
    b.onclick = function () { setProductionStatus(state, p.id, b.getAttribute('data-status')); save(); };
  });
  var search = pane.querySelector('#plSearch');
  var matches = pane.querySelector('#plMatches');
  if (search) search.oninput = function () {
    var q = search.value.trim();
    if (!q) { matches.innerHTML = ''; return; }
    var found = searchItems(state, { q: q }).slice(0, 6);
    matches.innerHTML = found.map(function (i) {
      var already = assignmentsFor(state, p.id).some(function (a) { return a.itemId === i.id; });
      return '<button class="btn small ghost" style="margin:4px 4px 0 0"' + (already ? ' disabled' : '') +
        ' data-add="' + i.id + '">' + esc(i.tagId) + ' ' + esc(i.name) + (already ? ' (on list)' : '') + '</button>';
    }).join('') || '<span class="muted">No match.</span>';
    matches.querySelectorAll('[data-add]').forEach(function (b) {
      b.onclick = function () {
        assignItem(state, p.id, b.getAttribute('data-add'), {});
        save();
      };
    });
  };
  pane.querySelectorAll('[data-af]').forEach(function (inp) {
    inp.onchange = function () {
      var a = state.assignments.find(function (x) { return x.id === inp.getAttribute('data-aid'); });
      if (a) { a[inp.getAttribute('data-af')] = inp.value.trim(); localStorage.setItem(LS_STATE, serializeVault(state)); }
    };
  });
  pane.querySelectorAll('[data-cycle]').forEach(function (b) {
    b.onclick = function () {
      var a = state.assignments.find(function (x) { return x.id === b.getAttribute('data-cycle'); });
      var order = ['planned', 'pulled', 'fitted', 'returned'];
      setAssignmentStatus(state, a.id, order[(order.indexOf(a.status) + 1) % order.length]);
      save();
    };
  });
  pane.querySelectorAll('[data-unassign]').forEach(function (b) {
    b.onclick = function () { unassignItem(state, b.getAttribute('data-unassign')); save(); };
  });
  var pp = pane.querySelector('#printPull'); if (pp) pp.onclick = function () { printPull(p); };
  var pl = pane.querySelector('#printPlot'); if (pl) pl.onclick = function () { printPlot(p); };
  var st = pane.querySelector('#printStrike'); if (st) st.onclick = function () { printStrike(p); };
  var lk = pane.querySelector('#lockUp'); if (lk) lk.onclick = function (e) { e.preventDefault(); upgradeModal('The print pack and strike report are Pro features.'); };
}

// ---------- print pack ----------
function printHTML(html) {
  el('printArea').innerHTML = '<div class="print-sheet">' + html + '</div>';
  window.print();
}
function printPull(p) {
  var sheet = pullSheet(state, p.id);
  printHTML('<h1>Pull sheet: ' + esc(p.name) + '</h1>' +
    '<div class="sub">Generated ' + todayISO() + ' by StageCloset. Walk the storage in rack order, tick as you pull.</div>' +
    sheet.groups.map(function (g) {
      return '<h3>' + esc(g.location) + '</h3><table><tr><th style="width:24px"></th><th>Tag</th><th>Item</th><th>Size</th><th>Character</th><th>Actor</th></tr>' +
        g.rows.map(function (r) {
          return '<tr><td><span class="checkbox"></span></td><td>' + esc(r.item ? r.item.tagId : '') + '</td><td>' + esc(r.item ? r.item.name : '') +
            '</td><td>' + esc(r.item ? r.item.size.raw : '') + '</td><td>' + esc(r.assignment.character) + '</td><td>' + esc(r.assignment.actor) + '</td></tr>';
        }).join('') + '</table>';
    }).join(''));
}
function printPlot(p) {
  var plot = costumePlot(state, p.id);
  printHTML('<h1>Costume plot: ' + esc(p.name) + '</h1>' +
    '<div class="sub">Generated ' + todayISO() + ' by StageCloset.</div>' +
    plot.map(function (ch) {
      return '<h3>' + esc(ch.character) + (ch.actor ? ' (' + esc(ch.actor) + ')' : '') + '</h3>' +
        '<table><tr><th>Scene</th><th>Tag</th><th>Piece</th><th>Size</th><th>Notes</th></tr>' +
        ch.pieces.map(function (pc) {
          return '<tr><td>' + esc(pc.assignment.scene) + '</td><td>' + esc(pc.item ? pc.item.tagId : '') + '</td><td>' +
            esc(pc.item ? pc.item.name : '') + '</td><td>' + esc(pc.item ? pc.item.size.raw : '') + '</td><td>' + esc(pc.item ? pc.item.notes : '') + '</td></tr>';
        }).join('') + '</table>';
    }).join(''));
}
function printStrike(p) {
  var rec = reconcile(state, p.id);
  printHTML('<h1>Strike report: ' + esc(p.name) + '</h1>' +
    '<div class="sub">Generated ' + todayISO() + ' by StageCloset. Every assigned piece not yet marked returned.</div>' +
    '<p><b>' + rec.missing.length + '</b> of ' + rec.assignedCount + ' assigned pieces unreturned. Replacement value at risk: <b>' + fmtMoney(rec.missingValueCents) + '</b>.</p>' +
    '<table><tr><th>Tag</th><th>Piece</th><th class="num">Value</th><th>Status</th><th>Last seen with</th></tr>' +
    rec.missing.map(function (m) {
      return '<tr><td>' + esc(m.item.tagId) + '</td><td>' + esc(m.item.name) + '</td><td>' + fmtMoney(m.item.valueCents) + '</td>' +
        '<td>' + (m.stillCheckedOut ? 'still checked out' : 'assignment ' + m.assignment.status) + '</td>' +
        '<td>' + esc(m.borrower || m.assignment.actor || '') + '</td></tr>';
    }).join('') + '</table>');
}
function printTags(items) {
  printHTML('<h1>Tag labels</h1><div class="sub">Cut along dashed lines. Safety-pin or sew into the garment.</div>' +
    '<div class="tag-grid">' + items.slice(0, 120).map(function (i) {
      return '<div class="tag-cell"><div class="tid">' + esc(i.tagId) + '</div><div class="tnm">' + esc(i.name) + '</div>' +
        '<div class="tmeta">' + esc(catLabel(i.category)) + (i.size.raw ? ' · ' + esc(i.size.raw) : '') + ' · StageCloset</div></div>';
    }).join('') + '</div>');
}

// ---------- dashboard ----------
function renderDashboard() {
  var pane = el('pane-dashboard');
  var d = dashboard(state, todayISO());
  var catRows = Object.entries(d.byCategory).sort(function (a, b) { return b[1] - a[1]; });
  var maxCat = catRows.length ? catRows[0][1] : 1;

  pane.innerHTML =
    '<div class="tiles">' +
    '<div class="tile"><div class="v">' + d.itemCount + '</div><div class="k">pieces in the closet</div></div>' +
    '<div class="tile"><div class="v gold">' + fmtMoney(d.totalValueCents) + '</div><div class="k">replacement value cataloged</div></div>' +
    '<div class="tile"><div class="v' + (d.outCount ? '' : '') + '">' + d.outCount + '</div><div class="k">checked out (' + fmtMoney(d.outValueCents) + ')</div></div>' +
    '<div class="tile"><div class="v' + (d.overdueList.length ? ' bad' : '') + '">' + d.overdueList.length + '</div><div class="k">overdue</div></div>' +
    '</div>' +
    (d.overdueList.length ? '<div class="panel"><h2>Overdue</h2><div class="table-scroll"><table class="grid">' +
      '<tr><th>Item</th><th>Borrower</th><th>Due</th><th>Days late</th></tr>' +
      d.overdueList.map(function (o) {
        var item = state.items.find(function (i) { return i.id === o.checkout.itemId; });
        return '<tr><td>' + esc(item ? item.tagId + ' ' + item.name : '?') + '</td><td>' + esc(o.checkout.borrower) +
          (o.checkout.contact ? ' <span class="muted">' + esc(o.checkout.contact) + '</span>' : '') + '</td>' +
          '<td>' + esc(o.checkout.dueDate) + '</td><td><span class="chip overdue">' + o.daysLate + 'd</span></td></tr>';
      }).join('') + '</table></div></div>' : '') +
    (d.repairList.length ? '<div class="panel"><h2>Repair rack (' + d.repairList.length + ')</h2><p class="muted">' +
      d.repairList.slice(0, 12).map(function (i) { return esc(i.tagId) + ' ' + esc(i.name); }).join(' · ') + '</p></div>' : '') +
    '<div class="panel"><h2>By category</h2>' +
    (catRows.length ? catRows.map(function (c) {
      return '<div class="cat-row"><span class="lbl">' + esc(catLabel(c[0])) + '</span><span class="bar"><i style="width:' +
        Math.round(100 * c[1] / maxCat) + '%"></i></span><span class="n">' + c[1] + '</span></div>';
    }).join('') : '<p class="muted">Nothing cataloged yet.</p>') + '</div>';
}

// ---------- vault / import ----------
function renderVault() {
  var pane = el('pane-vault');
  pane.innerHTML =
    '<div class="panel"><h2>Import a spreadsheet</h2>' +
    '<p class="muted">Paste your existing costume spreadsheet as CSV (File &gt; Download &gt; CSV in Google Sheets). ' +
    'Columns like Item, Size, Color, Room, Value, Notes are detected automatically.</p>' +
    '<textarea id="csvIn" rows="5" placeholder="Item Name,Type,Size,Color,Value,Room,Notes&#10;Victorian gown,dress,10,burgundy,250,Loft,hem fragile"></textarea>' +
    '<div class="row" style="margin-top:8px"><button class="btn" id="csvGo">Import rows</button>' +
    '<label class="btn ghost" style="cursor:pointer">From file<input type="file" id="csvFile" accept=".csv,text/csv" style="display:none"></label>' +
    '<span class="muted" id="csvMsg"></span></div></div>' +

    '<div class="panel"><h2>Backup and handover</h2>' +
    '<p class="muted">The vault file is the whole closet: items, photos, checkouts, productions, history. ' +
    'Export it before switching computers, and hand it to the next wardrobe manager when you pass the torch.</p>' +
    '<div class="row" style="margin-top:8px">' +
    '<button class="btn" id="vaultOut">Export vault (with photos)</button>' +
    '<label class="btn ghost" style="cursor:pointer">Restore vault<input type="file" id="vaultIn" accept=".stagecloset,.json" style="display:none"></label>' +
    '<button class="btn ghost" id="csvOut">Export CSV</button>' +
    '</div></div>' +

    '<div class="panel"><h2>License</h2>' +
    (isPro
      ? '<p>Pro is active on this browser. Thank you for keeping the curtain up.</p>'
      : '<p class="muted">Free plan: ' + FREE_ITEM_LIMIT + ' items, ' + FREE_PROD_LIMIT + ' active production. Pro is a one-time key, no account, works offline.</p>' +
        '<div class="row"><button class="btn gold" id="goPro">See what Pro adds</button></div>') +
    '</div>' +

    '<div class="panel"><h2>Danger zone</h2><div class="row">' +
    '<button class="btn ghost" id="demoBtn2">Load sample closet</button>' +
    '<button class="btn danger" id="wipeBtn">Erase everything</button></div></div>';

  el('csvGo').onclick = function () { doImport(el('csvIn').value); };
  el('csvFile').onchange = function (e) {
    var f = e.target.files[0];
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () { doImport(String(fr.result)); };
    fr.readAsText(f);
  };
  el('vaultOut').onclick = exportVaultWithPhotos;
  el('vaultIn').onchange = function (e) {
    var f = e.target.files[0];
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      var res = parseVault(String(fr.result));
      if (!res.ok) { alert(res.errors.join(' ')); return; }
      if (!confirm('Replace the current closet (' + state.items.length + ' items) with this vault (' + res.state.items.length + ' items)?')) return;
      state = res.state;
      var photos = res.photos || {};
      var chain = Promise.resolve();
      Object.keys(photos).forEach(function (pid) {
        chain = chain.then(function () {
          return fetch(photos[pid]).then(function (r) { return r.blob(); }).then(function (b) { return photoPut(pid, b); });
        });
      });
      chain.then(function () { urlCache.clear(); save(); });
    };
    fr.readAsText(f);
  };
  el('csvOut').onclick = function () { download('stagecloset-inventory.csv', exportCSV(state), 'text/csv'); };
  var gp = el('goPro'); if (gp) gp.onclick = function () { upgradeModal('Unlock the whole closet.'); };
  el('demoBtn2').onclick = loadSample;
  el('wipeBtn').onclick = function () {
    if (!confirm('Erase ALL items, history, productions, and photos from this browser?')) return;
    if (!confirm('Last chance. This cannot be undone unless you exported a vault.')) return;
    state.items.forEach(function (i) { i.photoIds.forEach(photoDel); });
    state = emptyState();
    urlCache.clear();
    save();
  };
}

function doImport(text) {
  var rows = parseCSV(text);
  if (!rows.length) { el('csvMsg').textContent = 'Nothing to import.'; return; }
  var before = state.items.length;
  var res = importRows(state, rows);
  if (!res.ok) { el('csvMsg').textContent = res.errors.join(' '); return; }
  if (!isPro && state.items.length > FREE_ITEM_LIMIT) {
    var over = state.items.length - FREE_ITEM_LIMIT;
    state.items.splice(FREE_ITEM_LIMIT);
    save();
    upgradeModal('Your spreadsheet has more pieces than the free plan holds. Imported the first ' +
      (FREE_ITEM_LIMIT - before) + ', left ' + over + ' behind. Pro imports everything.');
    return;
  }
  save();
  el('csvMsg').textContent = 'Imported ' + res.imported + ' items' + (res.skipped ? ', skipped ' + res.skipped : '') + '.';
}

function exportVaultWithPhotos() {
  var ids = [];
  state.items.forEach(function (i) { ids = ids.concat(i.photoIds); });
  var photos = {};
  var chain = Promise.resolve();
  ids.forEach(function (pid) {
    chain = chain.then(function () {
      return photoGet(pid).then(function (blob) {
        if (!blob) return;
        return new Promise(function (res) {
          var fr = new FileReader();
          fr.onload = function () { photos[pid] = fr.result; res(); };
          fr.readAsDataURL(blob);
        });
      });
    });
  });
  chain.then(function () {
    download('closet-' + todayISO() + '.stagecloset', serializeVault(state, { photos: photos }), 'application/json');
  });
}

// ---------- sample data ----------
function loadSample() {
  if (state.items.length && !confirm('Add the sample closet on top of your current data?')) return;
  var S = [
    ['Victorian ball gown', 'dress', '10', 'burgundy/gold', '1890s', 'F', 285, 'Costume Loft', 'Rack 3', '', 'boning intact, hem fragile'],
    ['Victorian day dress', 'dress', '8', 'grey/black', '1890s', 'F', 140, 'Costume Loft', 'Rack 3', '', ''],
    ['Flapper dress, beaded', 'dress', '6', 'black/silver', '1920s', 'F', 95, 'Costume Loft', 'Rack 2', '', 'shed beads, handle gently'],
    ['A-line shift dress', 'dress', '12', 'mustard', '1960s', 'F', 45, 'Costume Loft', 'Rack 2', '', ''],
    ['Tail coat', 'jacket', '42R', 'black', 'Victorian', 'M', 190, 'Costume Loft', 'Rack 1', '', ''],
    ['Tweed three-piece suit', 'jacket', '40R', 'brown', '1930s', 'M', 165, 'Costume Loft', 'Rack 1', '', 'vest included'],
    ['Leather bomber jacket', 'jacket', '44', 'brown', 'WWII', 'M', 120, 'Costume Loft', 'Rack 1', '', ''],
    ['Ruffled pirate shirt', 'shirt', 'L', 'ivory', '', 'U', 35, 'Costume Loft', 'Rack 4', '', ''],
    ['Peasant blouse', 'shirt', 'M', 'white', '', 'F', 20, 'Costume Loft', 'Rack 4', '', ''],
    ['High-waisted wool trousers', 'pants', 'W32 L34', 'charcoal', '1940s', 'M', 55, 'Costume Loft', 'Rack 4', '', ''],
    ['Sailor pants', 'pants', 'W30 L32', 'navy', 'WWII', 'M', 40, 'Costume Loft', 'Rack 4', '', ''],
    ['Full circle skirt', 'skirt', 'M', 'red', '1950s', 'F', 30, 'Costume Loft', 'Rack 2', '', ''],
    ['Character heels', 'shoes', '7.5', 'black', '', 'F', 48, 'Shoe Wall', 'Shelf B', 'Box 12', ''],
    ['Character heels', 'shoes', '8.5', 'tan', '', 'F', 48, 'Shoe Wall', 'Shelf B', 'Box 14', ''],
    ['Oxford dress shoes', 'shoes', '10.5', 'black', '', 'M', 40, 'Shoe Wall', 'Shelf C', 'Box 21', ''],
    ['Combat boots', 'shoes', '11', 'black', 'WWII', 'M', 65, 'Shoe Wall', 'Shelf C', 'Box 24', ''],
    ['Top hat', 'hat', 'OSFA', 'black', 'Victorian', 'U', 55, 'Costume Loft', 'Shelf A', 'Hat Box 2', ''],
    ['Cloche hat', 'hat', 'OSFA', 'cream', '1920s', 'F', 28, 'Costume Loft', 'Shelf A', 'Hat Box 3', ''],
    ['Army garrison cap', 'hat', '7 1/4', 'olive', 'WWII', 'M', 22, 'Costume Loft', 'Shelf A', 'Hat Box 5', ''],
    ['Pearl necklace + gloves set', 'accessory', '', 'white', '1920s', 'F', 18, 'Costume Loft', 'Shelf A', 'Bin 7', ''],
    ['Victorian gentleman wig', 'wig', '', 'grey', 'Victorian', 'M', 75, 'Wig Room', 'Shelf 1', 'Head 4', 'freshly styled'],
    ['Marie Antoinette wig', 'wig', '', 'white', '18th c.', 'F', 130, 'Wig Room', 'Shelf 1', 'Head 6', ''],
    ['US Army dress uniform', 'uniform', '40R', 'olive', 'WWII', 'M', 210, 'Costume Loft', 'Rack 5', '', 'insignia in bin 7'],
    ['Nurse uniform', 'uniform', 'M', 'white', '1940s', 'F', 60, 'Costume Loft', 'Rack 5', '', ''],
    ['Rotary telephone', 'prop', '', 'black', '1940s', '', 35, 'Props Room', 'Shelf 2', 'Bin 3', 'cord repaired'],
    ['Leather suitcase', 'prop', '', 'brown', '', '', 30, 'Props Room', 'Shelf 3', '', 'sticker residue'],
    ['Cavalry saber (prop steel)', 'prop', '', '', '', '', 90, 'Props Room', 'Locked Cabinet', '', 'stage combat cleared 2025'],
    ['Chaise lounge', 'set', '', 'green velvet', 'Victorian', '', 320, 'Scene Shop', 'Back wall', '', 'leg wobbles, shim before use']
  ];
  S.forEach(function (r) {
    addItem(state, {
      name: r[0], category: r[1], size: r[2], colors: r[3], era: r[4], gender: r[5],
      value: r[6], room: r[7], rack: r[8], bin: r[9], notes: r[10]
    });
  });
  var items = state.items;
  var byName = function (n) { return items.find(function (i) { return i.name === n; }); };

  var p1 = addProduction(state, { name: 'Radium Girls', opens: nDaysOut(21), closes: nDaysOut(31) }).production;
  if (isPro || activeProductions().length < FREE_PROD_LIMIT + 1) {
    assignItem(state, p1.id, byName('Victorian day dress').id, { character: 'Grace Fryer', actor: 'Emma T.', scene: '1' });
    assignItem(state, p1.id, byName('Nurse uniform').id, { character: 'Nurse', actor: 'Priya S.', scene: '4' });
    assignItem(state, p1.id, byName('Tweed three-piece suit').id, { character: 'Mr. Roeder', actor: 'Leo M.', scene: '2' });
    assignItem(state, p1.id, byName('High-waisted wool trousers').id, { character: 'Tom', actor: 'Dev K.', scene: '3' });
    assignItem(state, p1.id, byName('Rotary telephone').id, { character: '', actor: '', scene: '2' });
  }

  checkOut(state, byName('Leather bomber jacket').id, {
    borrower: 'Marcus Webb', contact: '555-0142', dueDate: nDaysOut(-9), date: nDaysOut(-23), note: 'senior photo shoot'
  });
  checkOut(state, byName('Top hat').id, {
    borrower: 'Riverside Middle School', contact: 'drama@riverside.example', dueDate: nDaysOut(5), date: nDaysOut(-2), note: 'loan for their revue'
  });
  checkOut(state, byName('Marie Antoinette wig').id, {
    borrower: 'Jamie Chen', dueDate: nDaysOut(-2), date: nDaysOut(-12), note: 'restyling at home'
  });

  var chaise = byName('Chaise lounge');
  updateItem(state, chaise.id, { condition: 'needs repair' });
  save();
}
function nDaysOut(n) {
  var d = new Date(Date.now() + n * 86400000);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ---------- chrome ----------
function renderChrome() {
  el('cntItems').textContent = state.items.length ? '(' + state.items.length + ')' : '';
  var out = openCheckouts(state).length;
  el('cntOut').textContent = out ? '(' + out + ')' : '';
  el('cntProds').textContent = state.productions.length ? '(' + state.productions.length + ')' : '';
  var badge = el('proBadge');
  badge.textContent = isPro ? 'Pro' : 'Free plan';
  badge.classList.toggle('active', isPro);
  badge.onclick = function () { upgradeModal(isPro ? 'Pro is active.' : 'Unlock the whole closet.'); };
  el('footState').textContent = state.items.length + ' items · ' +
    (isPro ? 'Pro' : 'free plan ' + state.items.length + '/' + FREE_ITEM_LIMIT);
}

function renderAll() {
  renderChrome(); renderCloset(); renderCheckout(); renderProductions(); renderDashboard(); renderVault();
}

// tabs
document.querySelectorAll('nav.tabs button').forEach(function (b) {
  b.onclick = function () {
    document.querySelectorAll('nav.tabs button').forEach(function (x) { x.classList.remove('active'); });
    document.querySelectorAll('.tabpane').forEach(function (x) { x.classList.remove('active'); });
    b.classList.add('active');
    el('pane-' + b.getAttribute('data-tab')).classList.add('active');
  };
});

renderAll();
