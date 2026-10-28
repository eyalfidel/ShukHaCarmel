/* טופס המילוי: דיווח על כתובת, השלמת עסקים סגורים, צמתים. */
(function () {
  'use strict';
  var S = window.Shuk;
  var $ = function (id) { return document.getElementById(id); };
  var MAIN_STREET = 'הכרמל';

  var state = {
    byStreet: {},          // רחוב -> [כתובות]
    junctionsCalc: [],     // צמתים מחושבים (data/junctions.json)
    server: { businesses: [], junctions: [] },
    visit: null            // { id, gpsOpen }
  };
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
      ['report', 'pending', 'junction'].forEach(function (t) { $('tab-' + t).classList.toggle('hidden', t !== b.dataset.tab); });
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
      renderLinkedList(); renderExisting(); renderPending(); renderJunctions();
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
    onAddressChange();
  });

  function onAddressChange() {
    var a = currentAddr();
    renderExisting();
    if (!a) { $('addrInfo').textContent = ''; state.visit = null; return; }
    // ביקור חדש: GPS פתיחה
    var visit = state.visit = { id: S.uid(), gpsOpen: null };
    $('addrInfo').textContent = a.street + ' ' + a.house + (a.side ? ' · צד ' + a.side : '') + ' · מאתר מיקום…';
    S.gps().then(function (g) {
      if (state.visit !== visit) return;
      visit.gpsOpen = g;
      $('addrInfo').textContent = a.street + ' ' + a.house + (a.side ? ' · צד ' + a.side : '') +
        (g ? ' · מיקום נשמר (±' + g.acc + ' מ\')' : ' · אין מיקום');
    });
  }

  function renderExisting() {
    var a = currentAddr(), box = $('existingAtAddr');
    if (!a) { box.innerHTML = ''; return; }
    var rows = state.server.businesses.filter(function (b) { return b.street === a.street && String(b.house) === a.house; });
    if (!rows.length) { box.innerHTML = '<p class="muted">עוד לא דווחו עסקים בכתובת הזו.</p>'; return; }
    box.innerHTML = '<p class="muted" style="margin-bottom:0">כבר דווחו כאן:</p>' + rows.map(function (b) {
      return '<div class="list-item"><span>' + bizLabel(b) + '</span>' +
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
    var a = currentAddr();
    if (!a) { $('submitErr').textContent = 'צריך לבחור כתובת'; return; }
    var btn = $('submitVisit'); btn.disabled = true;
    var visit = state.visit || { id: S.uid(), gpsOpen: null };
    Promise.all(cards.map(function (c) { return c.read(); })).then(function (res) {
      var errs = [];
      res.forEach(function (r, i) { r.errs.forEach(function (e) { errs.push('עסק ' + (i + 1) + ': ' + e); }); });
      if (errs.length) { $('submitErr').innerHTML = errs.map(S.esc).join('<br>'); return; }
      return S.gps().then(function (g) {
        var go = visit.gpsOpen || {}, gc = g || {};
        var payload = {
          action: 'submitVisit', visit_id: visit.id,
          street: a.street, house: a.house, side: a.side,
          gps_open_lat: go.lat, gps_open_lng: go.lng, gps_open_acc: go.acc,
          gps_close_lat: gc.lat, gps_close_lng: gc.lng, gps_close_acc: gc.acc,
          businesses: res.map(function (r) { return Object.assign({ client_id: S.uid() }, r.rec); })
        };
        // מוסיפים מקומית כדי שיופיע מיד ב"כבר דווחו כאן" גם בלי רשת
        payload.businesses.forEach(function (b) {
          state.server.businesses.push(Object.assign({ street: a.street, house: a.house, side: a.side, id: '' }, b, { photo: undefined }));
        });
        return S.enqueue(payload, a.street + ' ' + a.house).then(function () {
          toast('נשמר: ' + a.street + ' ' + a.house + ' (' + payload.businesses.length + ' עסקים)');
          cards.forEach(function (c) { c.el.remove(); }); cards = [];
          addCard();
          state.visit = null;
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
    rows.sort(function (x, y) { return x.street.localeCompare(y.street) || S.cmpHouse(String(x.house), String(y.house)); });
    $('pendingCount').textContent = rows.length ? '(' + rows.length + ')' : '';
    if (!rows.length) { $('pendingList').innerHTML = 'אין כרגע עסקים להשלמה.'; return; }
    $('pendingList').innerHTML = rows.map(function (b) {
      return '<div class="list-item"><span><b>' + S.esc(b.street + ' ' + b.house) + '</b> · ' + S.esc(b.structure || '') +
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
    var c = makeCard(b, { completing: true, noRemove: true, title: 'השלמה: ' + b.street + ' ' + b.house });
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
        return Promise.all([gpsOpenP, S.gps()]).then(function (g) {
          var go = g[0] || {}, gc = g[1] || {};
          var upd = Object.assign({}, r.rec, {
            gps_open_lat: go.lat, gps_open_lng: go.lng, gps_open_acc: go.acc,
            gps_close_lat: gc.lat, gps_close_lng: gc.lng, gps_close_acc: gc.acc
          });
          return S.enqueue({ action: 'updateBusiness', id: b.id, business: upd }, 'השלמה ' + b.street + ' ' + b.house).then(function () {
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

  // ---------- צמתים ----------

  function renderJunctions() {
    var done = {};
    state.server.junctions.forEach(function (j) { done[j.cross_street] = j; });
    var fmt = function (arr) {
      if (arr[0] && arr[1]) return 'בין ' + arr[0] + '–' + arr[1];
      return arr[0] ? 'אחרי ' + arr[0] : arr[1] ? 'לפני ' + arr[1] : '?';
    };
    $('juncList').innerHTML = state.junctionsCalc.map(function (j, i) {
      var ok = done[j.cross_street];
      var sides = [];
      if (j.odd_side) sides.push('אי-זוגי ' + fmt(j.odd_between));
      if (j.even_side) sides.push('זוגי ' + fmt(j.even_between));
      return '<div class="list-item"><span><b>' + S.esc(j.cross_street) + '</b><br><span class="muted">' + S.esc(sides.join(' · ')) + '</span></span>' +
        (ok ? '<span class="side-pill">אושר ע"י ' + S.esc(ok.created_by || '') + '</span>' : '<button class="btn small" data-j="' + i + '">אישור</button>') + '</div>';
    }).join('');
    var extra = state.server.junctions.filter(function (j) {
      return !state.junctionsCalc.some(function (c) { return c.cross_street === j.cross_street; });
    });
    if (extra.length) {
      $('juncList').innerHTML += '<p class="muted">נוספו ידנית:</p>' + extra.map(function (j) {
        return '<div class="list-item"><span><b>' + S.esc(j.cross_street) + '</b> · ' + S.esc(j.side || '') + ' בין ' + S.esc(j.between_from + '–' + j.between_to) + '</span><span class="muted">' + S.esc(j.created_by || '') + '</span></div>';
      }).join('');
    }
    $('juncList').querySelectorAll('[data-j]').forEach(function (btn) {
      btn.onclick = function () {
        var j = state.junctionsCalc[+btn.dataset.j];
        var side = j.odd_side && j.even_side ? 'שני הצדדים' : (j.odd_side ? 'אי-זוגי' : 'זוגי');
        var bt = j.odd_side ? j.odd_between : j.even_between;
        sendJunction({ street: j.street, cross_street: j.cross_street, side: side, between_from: bt[0] || '', between_to: bt[1] || '', note: '' });
      };
    });
  }

  function sendJunction(rec) {
    return S.gps().then(function (g) {
      rec.client_id = S.uid();
      if (g) { rec.lat = g.lat; rec.lng = g.lng; }
      return S.enqueue({ action: 'addJunction', junction: rec }, 'צומת ' + rec.cross_street).then(function () {
        state.server.junctions.push(Object.assign({ created_by: S.getUser() }, rec));
        renderJunctions();
        toast('הצומת נרשם: ' + rec.cross_street);
      });
    });
  }

  $('jAdd').onclick = function () {
    var cross = $('jCross').value.trim();
    var side = (document.querySelector('input[name=jside]:checked') || {}).value;
    if (!cross || !side) return toast('צריך רחוב חוצה וצד');
    sendJunction({ street: MAIN_STREET, cross_street: cross, side: side, between_from: $('jFrom').value, between_to: $('jTo').value, note: $('jNote').value.trim() })
      .then(function () { $('jCross').value = ''; $('jNote').value = ''; });
  };

  // ---------- טעינה ----------

  Promise.all([S.loadJSON('data/addresses.json'), S.loadJSON('data/junctions.json')]).then(function (r) {
    r[0].forEach(function (a) { (state.byStreet[a.street] = state.byStreet[a.street] || []).push(a); });
    Object.keys(state.byStreet).forEach(function (s) { state.byStreet[s].sort(function (x, y) { return S.cmpHouse(x.house, y.house); }); });
    var streets = Object.keys(state.byStreet).sort(function (a, b) { return (a !== MAIN_STREET) - (b !== MAIN_STREET) || a.localeCompare(b, 'he'); });
    $('streetList').innerHTML = streets.map(function (s) { return '<option value="' + S.esc(s) + '">'; }).join('');
    houseOptions($('house'), MAIN_STREET, true);
    houseOptions($('jFrom'), MAIN_STREET); houseOptions($('jTo'), MAIN_STREET);
    state.junctionsCalc = r[1];
    renderJunctions();
  });
  addCard();
  if (S.getCode()) showApp(); else showLogin();
})();
