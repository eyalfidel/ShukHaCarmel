/* טופס המילוי: דיווח על כתובת או נקודה בשוק, והשלמת עסקים סגורים. */
(function () {
  'use strict';
  var S = window.Shuk;
  var $ = function (id) { return document.getElementById(id); };
  var MAIN_STREET = 'הכרמל';

  var state = {
    byStreet: {},          // רחוב -> [כתובות]
    server: { businesses: [], junctions: [] },
    area: 'רחוב',          // 'רחוב' או שם אזור מתוך config (השוק המערבי, שוק הבשר...)
    point: null,           // נקודה שנבחרה על המפה באזור בלי כתובות
    visit: null            // { id, gpsOpen }
  };
  var placeMap = null, placeMarker = null;
  var cardSeq = 0;

  // ---------- כללי ----------

  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }

  function showLogin() {
    $('appView').classList.add('hidden');
    $('loginView').classList.remove('hidden');
    $('loginCode').focus();
  }

  function showApp() {
    $('loginView').classList.add('hidden');
    $('appView').classList.remove('hidden');
    $('userBadge').textContent = S.getUser() + (S.isMock() ? ' · הדגמה' : '');
    refresh();
    S.flush();
  }

  $('loginBtn').onclick = function () {
    $('loginErr').textContent = '';
    $('loginBtn').disabled = true;
    S.login($('loginCode').value).then(showApp, function (e) {
      $('loginErr').textContent = e.message || 'שגיאת תקשורת';
    }).finally(function () { $('loginBtn').disabled = false; });
  };
  $('loginCode').onkeydown = function (e) { if (e.key === 'Enter') $('loginBtn').click(); };
  $('logoutBtn').onclick = function () {
    if (confirm('לצאת? דיווחים שעדיין בתור יישלחו רק אחרי כניסה מחדש.')) { S.logout(); showLogin(); }
  };

  // לשוניות
  document.querySelectorAll('nav.tabs button').forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll('nav.tabs button').forEach(function (x) { x.classList.toggle('active', x === b); });
      ['report', 'pending'].forEach(function (t) { $('tab-' + t).classList.toggle('hidden', t !== b.dataset.tab); });
      if (b.dataset.tab !== 'report') refresh();
    };
  });

  // תור
  S.onQueueChange(function (items) {
    var badge = $('queueBadge');
    var failed = items.filter(function (i) { return i.error; }).length;
    badge.classList.toggle('hidden', !items.length);
    badge.classList.toggle('warn', !!items.length);
    badge.textContent = items.length + ' ממתינים לשליחה' + (failed ? ' (' + failed + ' נדחו)' : '');
    badge.title = items.map(function (i) { return i.label + (i.error ? ' - ' + i.error : ''); }).join('\n');
    if (!items.length && state.hadQueue) refresh();
    state.hadQueue = items.length > 0;
    var err = S.lastError();
    if (err && err.auth) { toast('הקוד כבר לא פעיל - צריך להיכנס מחדש'); S.logout(); showLogin(); }
  });
  $('queueBadge').onclick = function () {
    S.queueList().then(function (items) {
      var bad = items.filter(function (i) { return i.error; });
      if (!bad.length) { S.flush(); toast('מנסה לשלוח…'); return; }
      if (confirm(bad.length + ' דיווחים נדחו ע"י השרת:\n' + bad.map(function (i) { return i.label + ': ' + i.error; }).join('\n') + '\n\nלמחוק אותם מהתור?')) {
        bad.forEach(function (i) { S.dropQueued(i.qid); });
      }
    });
  };

  function refresh() {
    if (!S.getCode()) return Promise.resolve();
    return S.apiGet({ code: S.getCode() }).then(function (j) {
      state.server = { businesses: j.businesses || [], junctions: j.junctions || [] };
      renderLinkedList(); renderExisting(); renderPending();
    }, function (e) {
      if (e.auth) { S.logout(); showLogin(); }
      // בלי רשת - ממשיכים עם מה שיש
    });
  }

  // ---------- כתובות ----------

  function houseOptions(sel, street, withOther) {
    var list = state.byStreet[street] || [];
    sel.innerHTML = '<option value="">בחירה…</option>' + list.map(function (a) {
      return '<option value="' + S.esc(a.house) + '">' + S.esc(a.house) + ' · ' + a.side + '</option>';
    }).join('') + (withOther ? '<option value="__other">מספר אחר…</option>' : '');
  }

  // המיקום הנוכחי בטופס: כתובת ברחוב, או נקודה באזור בלי כתובות
  function currentLoc() {
    if (state.area !== S.STREET_AREA) {
      if (!state.point) return null;
      return { area: state.area, stall: $('stall').value.trim(), loc_lat: state.point.lat, loc_lng: state.point.lng };
    }
    var a = currentAddr();
    return a && Object.assign({ area: S.STREET_AREA }, a);
  }

  function currentAddr() {
    var street = $('street').value.trim(), house = $('house').value;
    if (!street || !house) return null;
    var a = (state.byStreet[street] || []).filter(function (x) { return x.house === house; })[0];
    if (a) return a;
    var n = parseInt(house, 10);
    return { street: street, house: house, side: isNaN(n) ? '' : (n % 2 ? 'אי-זוגי' : 'זוגי') };
  }

  $('street').addEventListener('change', function () {
    houseOptions($('house'), $('street').value.trim(), true);
    state.visit = null;
    onAddressChange();
  });
  $('house').addEventListener('change', function () {
    if ($('house').value === '__other') {
      var v = (prompt('מספר בית:') || '').trim();
      if (v) {
        var o = document.createElement('option'); o.value = v; o.textContent = v;
        $('house').insertBefore(o, $('house').lastChild); $('house').value = v;
      } else $('house').value = '';
    }
    state.visit = null;
    onAddressChange();
  });

  function locText(l) {
    return l.street ? l.street + ' ' + l.house + (l.side ? ' · צד ' + l.side : '') : l.area + (l.stall ? ' · ' + l.stall : '');
  }

  function onAddressChange() {
    var l = currentLoc();
    renderExisting();
    if (!l) { $('addrInfo').textContent = state.area === S.STREET_AREA ? '' : 'צריך לסמן נקודה על המפה'; state.visit = null; return; }
    if (state.visit) { $('addrInfo').textContent = locText(l) + gpsText(state.visit.gpsOpen); return; }
    // ביקור חדש: GPS פתיחה
    var visit = state.visit = { id: S.uid(), gpsOpen: undefined };
    $('addrInfo').textContent = locText(l) + ' · מאתר מיקום…';
    S.gps().then(function (g) {
      if (state.visit !== visit) return;
      visit.gpsOpen = g;
      var cur = currentLoc();
      if (cur) $('addrInfo').textContent = locText(cur) + gpsText(g);
    });
  }
  function gpsText(g) {
    if (g === undefined) return ' · מאתר מיקום…';
    return g ? ' · מיקום נשמר (±' + g.acc + ' מ\')' : ' · אין מיקום';
  }

  // ---------- אזורים בלי כתובות ----------

  function setArea(area) {
    state.area = area;
    state.visit = null;
    var isStreet = area === S.STREET_AREA;
    $('streetBox').classList.toggle('hidden', !isStreet);
    $('placeBox').classList.toggle('hidden', isStreet);
    if (!isStreet) {
      initPlaceMap();
      if (!state.point) locateMe();
    }
    onAddressChange();
  }

  function initPlaceMap() {
    if (placeMap || !window.L) { if (placeMap) setTimeout(function () { placeMap.invalidateSize(); }, 50); return; }
    placeMap = L.map('placeMap').setView(S.CENTER, 19);
    S.baseLayers(placeMap);
    placeMap.on('click', function (e) { setPoint(e.latlng.lat, e.latlng.lng); });
    setTimeout(function () { placeMap.invalidateSize(); }, 50);
  }

  function setPoint(lat, lng) {
    state.point = { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
    if (placeMap) {
      if (!placeMarker) {
        placeMarker = L.marker([lat, lng], { draggable: true, icon: L.divIcon({ className: 'pin', iconSize: [22, 22], iconAnchor: [11, 22] }) }).addTo(placeMap);
        placeMarker.on('dragend', function () { var p = placeMarker.getLatLng(); setPoint(p.lat, p.lng); });
      } else placeMarker.setLatLng([lat, lng]);
    }
    onAddressChange();
  }

  function locateMe() {
    S.gps().then(function (g) {
      if (!g) return toast('אין מיקום - לחצו על המפה במקום הדוכן');
      setPoint(g.lat, g.lng);
      if (placeMap) placeMap.setView([g.lat, g.lng], 19);
    });
  }
  $('useGps').onclick = locateMe;
  $('stall').addEventListener('input', function () { var l = currentLoc(); if (l) $('addrInfo').textContent = locText(l) + gpsText(state.visit && state.visit.gpsOpen); });

  function renderExisting() {
    var l = currentLoc(), box = $('existingAtAddr');
    if (!l) { box.innerHTML = ''; return; }
    var rows = state.server.businesses.filter(function (b) {
      if (l.street) return b.street === l.street && String(b.house) === l.house;
      // באזור בלי כתובות: עסקים שסומנו עד 15 מטר מהנקודה
      return b.area === l.area && b.loc_lat && S.distM(+b.loc_lat, +b.loc_lng, l.loc_lat, l.loc_lng) <= 15;
    });
    if (!rows.length) { box.innerHTML = '<p class="muted">עוד לא דווחו עסקים ' + (l.street ? 'בכתובת הזו.' : 'ליד הנקודה הזו.') + '</p>'; return; }
    box.innerHTML = '<p class="muted" style="margin-bottom:0">' + (l.street ? 'כבר דווחו כאן:' : 'כבר דווחו בקרבת מקום:') + '</p>' + rows.map(function (b) {
      return '<div class="list-item"><span>' + (l.street ? '' : S.esc(b.stall || '') + ' ') + bizLabel(b) + '</span>' +
        (b.status === 'closed' ? '<button class="btn small" data-edit="' + S.esc(b.id) + '">השלמה</button>' : '') + '</div>';
    }).join('');
    box.querySelectorAll('[data-edit]').forEach(function (btn) {
      btn.onclick = function () { openEdit(btn.dataset.edit); };
    });
  }

  function bizLabel(b) {
    var who = [b.first_name, b.last_name].filter(Boolean).join(' ');
    var parts = [b.structure, b.business_name || b.business_type, who ? 'של ' + who : ''].filter(Boolean);
    return S.esc(parts.join(' – ')) + (b.status === 'closed' ? ' <span class="side-pill">סגור – להשלים</span>' : '');
  }

  function renderLinkedList() {
    var names = {};
    state.server.businesses.forEach(function (b) { if (b.linked_to) names[b.linked_to] = 1; });
    $('linkedList').innerHTML = Object.keys(names).sort().map(function (n) { return '<option value="' + S.esc(n) + '">'; }).join('');
  }

  // ---------- כרטיס עסק ----------

  function chips(container, name, values, current) {
    container.innerHTML = values.map(function (v) {
      return '<label><input type="radio" name="' + name + '" value="' + S.esc(v) + '"' + (v === current ? ' checked' : '') + '>' + S.esc(v) + '</label>';
    }).join('');
  }

  function makeCard(init, opts) {
    init = init || {}; opts = opts || {};
    var el = document.importNode($('bizTpl').content, true).firstElementChild;
    var n = ++cardSeq;
    var f = function (k) { return el.querySelector('[data-field="' + k + '"]'); };
    chips(f('structure'), 'st' + n, S.STRUCTURES, init.structure);
    chips(f('business_type'), 'bt' + n, S.BUSINESS_TYPES, init.business_type);
    chips(f('tenure'), 'tn' + n, S.TENURES, init.tenure);
    ['first_name', 'last_name', 'phone', 'business_name', 'linked_to', 'note'].forEach(function (k) {
      if (init[k] != null) f(k).value = init[k];
    });
    var closed = f('closed');
    closed.checked = opts.allowClosed !== false && init.status === 'closed' && !opts.completing;
    if (opts.allowClosed === false) closed.parentElement.classList.add('hidden');
    function sync() {
      el.querySelector('.open-only').classList.toggle('hidden', closed.checked);
      el.classList.toggle('closed', closed.checked);
    }
    closed.onchange = sync; sync();

    var prev = el.querySelector('.photo-prev');
    f('photo').onchange = function () {
      var file = f('photo').files[0];
      if (!file) { prev.classList.add('hidden'); return; }
      prev.src = URL.createObjectURL(file); prev.classList.remove('hidden');
    };
    if (opts.title) el.querySelector('.biz-title').textContent = opts.title;
    if (opts.noRemove) el.querySelector('.rm').classList.add('hidden');

    function radio(k) { var r = f(k).querySelector('input:checked'); return r ? r.value : ''; }

    return {
      el: el,
      read: function () {
        var rec = {
          structure: radio('structure'),
          status: closed.checked ? 'closed' : 'filled',
          note: f('note').value.trim()
        };
        if (!closed.checked) {
          ['first_name', 'last_name', 'phone', 'business_name', 'linked_to'].forEach(function (k) { rec[k] = f(k).value.trim(); });
          rec.business_type = radio('business_type');
          rec.tenure = radio('tenure');
        }
        var errs = [];
        if (!rec.structure) errs.push('חסר סוג מבנה (בסטה/חנות)');
        if (!closed.checked && !rec.business_name && !rec.first_name) errs.push('חסר שם עסק או שם פרטי');
        if (rec.phone && !/^[0-9+\-\s()]{7,}$/.test(rec.phone)) errs.push('מספר טלפון לא תקין');
        var file = !closed.checked && f('photo').files[0];
        var p = file ? S.resizeImage(file) : Promise.resolve(null);
        return p.then(function (photo) {
          if (photo) rec.photo = photo;
          return { rec: rec, errs: errs };
        });
      }
    };
  }

  // ---------- דיווח ----------

  var cards = [];
  function addCard() {
    var c = makeCard();
    cards.push(c);
    c.el.querySelector('.rm').onclick = function () {
      if (cards.length === 1) return toast('צריך לפחות עסק אחד');
      cards = cards.filter(function (x) { return x !== c; });
      c.el.remove(); renumber();
    };
    $('bizList').appendChild(c.el);
    renumber();
    return c;
  }
  function renumber() {
    cards.forEach(function (c, i) { c.el.querySelector('.biz-title').textContent = 'עסק ' + (i + 1); });
  }
  $('addBiz').onclick = function () { addCard().el.scrollIntoView({ behavior: 'smooth' }); };

  $('submitVisit').onclick = function () {
    $('submitErr').textContent = '';
    var a = currentLoc();
    if (!a) { $('submitErr').textContent = state.area === S.STREET_AREA ? 'צריך לבחור כתובת' : 'צריך לסמן נקודה על המפה'; return; }
    var btn = $('submitVisit'); btn.disabled = true;
    var visit = state.visit || { id: S.uid(), gpsOpen: null };
    Promise.all(cards.map(function (c) { return c.read(); })).then(function (res) {
      var errs = [];
      res.forEach(function (r, i) { r.errs.forEach(function (e) { errs.push('עסק ' + (i + 1) + ': ' + e); }); });
      if (errs.length) { $('submitErr').innerHTML = errs.map(S.esc).join('<br>'); return; }
      return S.gps(4000).then(function (g) {
        var go = visit.gpsOpen || {}, gc = g || {};
        var payload = {
          action: 'submitVisit', visit_id: visit.id,
          street: a.street || '', house: a.house || '', side: a.side || '',
          area: a.area, stall: a.stall || '', loc_lat: a.loc_lat || '', loc_lng: a.loc_lng || '',
          gps_open_lat: go.lat, gps_open_lng: go.lng, gps_open_acc: go.acc,
          gps_close_lat: gc.lat, gps_close_lng: gc.lng, gps_close_acc: gc.acc,
          businesses: res.map(function (r) { return Object.assign({ client_id: S.uid() }, r.rec); })
        };
        // מוסיפים מקומית כדי שיופיע מיד ב"כבר דווחו כאן" גם בלי רשת
        payload.businesses.forEach(function (b) {
          state.server.businesses.push(Object.assign({}, a, { id: '' }, b, { photo: undefined }));
        });
        var label = S.placeLabel(a);
        return S.enqueue(payload, label).then(function () {
          toast('נשמר: ' + label + ' (' + payload.businesses.length + ' עסקים)');
          cards.forEach(function (c) { c.el.remove(); }); cards = [];
          addCard();
          state.visit = null;
          if (!a.street) { $('stall').value = ''; onAddressChange(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
          // מקדמים לכתובת הבאה באותו צד, כדי לחסוך בחירה
          var list = state.byStreet[a.street] || [];
          var same = list.filter(function (x) { return x.side === a.side; });
          var idx = same.map(function (x) { return x.house; }).indexOf(a.house);
          if (idx >= 0 && same[idx + 1]) $('house').value = same[idx + 1].house;
          onAddressChange();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      });
    }).catch(function (e) { $('submitErr').textContent = e.message; })
      .finally(function () { btn.disabled = false; });
  };

  // ---------- להשלים ----------

  function renderPending() {
    var rows = state.server.businesses.filter(function (b) { return b.status === 'closed' && b.id; });
    rows.sort(function (x, y) {
      return String(x.area || '').localeCompare(y.area || '') || String(x.street || '').localeCompare(y.street || '') ||
        S.cmpHouse(String(x.house), String(y.house));
    });
    $('pendingCount').textContent = rows.length ? '(' + rows.length + ')' : '';
    if (!rows.length) { $('pendingList').innerHTML = 'אין כרגע עסקים להשלמה.'; return; }
    $('pendingList').innerHTML = rows.map(function (b) {
      return '<div class="list-item"><span><b>' + S.esc(S.placeLabel(b)) + '</b> · ' + S.esc(b.structure || '') +
        (b.note ? '<br><span class="muted">' + S.esc(b.note) + '</span>' : '') +
        '<br><span class="muted">סומן ע"י ' + S.esc(b.created_by || '') + '</span></span>' +
        '<button class="btn small" data-edit="' + S.esc(b.id) + '">השלמה</button></div>';
    }).join('');
    $('pendingList').querySelectorAll('[data-edit]').forEach(function (btn) {
      btn.onclick = function () { openEdit(btn.dataset.edit); };
    });
  }

  function openEdit(id) {
    var b = state.server.businesses.filter(function (x) { return x.id === id; })[0];
    if (!b) return;
    document.querySelector('nav.tabs button[data-tab="pending"]').click();
    var wrap = $('editWrap'); wrap.innerHTML = '';
    var c = makeCard(b, { completing: true, noRemove: true, title: 'השלמה: ' + S.placeLabel(b) });
    var actions = document.createElement('div'); actions.className = 'actions';
    actions.innerHTML = '<button class="btn primary">שמירה</button><button class="btn ghost">ביטול</button><div class="err" style="width:100%"></div>';
    c.el.appendChild(actions);
    wrap.appendChild(c.el);
    c.el.scrollIntoView({ behavior: 'smooth' });
    var gpsOpenP = S.gps();
    actions.children[1].onclick = function () { wrap.innerHTML = ''; };
    actions.children[0].onclick = function () {
      var btn = actions.children[0]; btn.disabled = true;
      c.read().then(function (r) {
        if (r.errs.length) { actions.children[2].innerHTML = r.errs.map(S.esc).join('<br>'); return; }
        return Promise.all([gpsOpenP, S.gps(4000)]).then(function (g) {
          var go = g[0] || {}, gc = g[1] || {};
          var upd = Object.assign({}, r.rec, {
            gps_open_lat: go.lat, gps_open_lng: go.lng, gps_open_acc: go.acc,
            gps_close_lat: gc.lat, gps_close_lng: gc.lng, gps_close_acc: gc.acc
          });
          return S.enqueue({ action: 'updateBusiness', id: b.id, business: upd }, 'השלמה ' + S.placeLabel(b)).then(function () {
            Object.assign(b, upd, { photo: undefined });
            wrap.innerHTML = '';
            renderPending(); renderExisting();
            toast('ההשלמה נשמרה');
          });
        });
      }).finally(function () { btn.disabled = false; });
    };
  }
  $('refreshBtn').onclick = function () { refresh().then(function () { toast('עודכן'); }); };

  // ---------- טעינה ----------

  $('areaChips').innerHTML = [S.STREET_AREA].concat(S.AREAS).map(function (a, i) {
    return '<label><input type="radio" name="area" value="' + S.esc(a) + '"' + (i ? '' : ' checked') + '>' + S.esc(i ? a : 'רחוב (לפי כתובת)') + '</label>';
  }).join('');
  $('areaChips').addEventListener('change', function (e) { setArea(e.target.value); });

  S.loadJSON('data/addresses.json').then(function (rows) {
    rows.forEach(function (a) { (state.byStreet[a.street] = state.byStreet[a.street] || []).push(a); });
    Object.keys(state.byStreet).forEach(function (s) { state.byStreet[s].sort(function (x, y) { return S.cmpHouse(x.house, y.house); }); });
    var streets = Object.keys(state.byStreet).sort(function (a, b) { return (a !== MAIN_STREET) - (b !== MAIN_STREET) || a.localeCompare(b, 'he'); });
    $('streetList').innerHTML = streets.map(function (s) { return '<option value="' + S.esc(s) + '">'; }).join('');
    houseOptions($('house'), MAIN_STREET, true);
  });
  addCard();
  if (S.getCode()) showApp(); else showLogin();
})();
