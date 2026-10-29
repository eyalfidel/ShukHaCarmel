/* טופס המילוי: עסק חדש / עסק ריק, והשלמת עסקים ריקים. */
(function () {
  'use strict';
  var S = window.Shuk;
  var $ = function (id) { return document.getElementById(id); };
  var form = $('bizForm');

  var state = {
    addrIndex: {},         // 'רחוב|מספר' -> כתובת מ-data/addresses.json
    server: { businesses: [], junctions: [] },
    mode: null,            // 'full' | 'empty' | 'complete'
    editing: null,         // העסק שמשלימים (במצב complete)
    visit: null,           // { id, gpsOpen }
    hadQueue: false
  };

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

  function showTab(name) {
    document.querySelectorAll('nav.tabs button').forEach(function (x) { x.classList.toggle('active', x.dataset.tab === name); });
    ['report', 'pending'].forEach(function (t) { $('tab-' + t).classList.toggle('hidden', t !== name); });
  }
  document.querySelectorAll('nav.tabs button').forEach(function (b) {
    b.onclick = function () {
      showTab(b.dataset.tab);
      if (b.dataset.tab === 'pending') refresh();
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
      renderLinkedList(); renderPending(); renderExisting();
    }, function (e) {
      if (e.auth) { S.logout(); showLogin(); }
      // בלי רשת - ממשיכים עם מה שיש
    });
  }

  function renderLinkedList() {
    var names = {};
    state.server.businesses.forEach(function (b) { if (b.linked_to) names[b.linked_to] = 1; });
    $('linkedList').innerHTML = Object.keys(names).sort().map(function (n) { return '<option value="' + S.esc(n) + '">'; }).join('');
  }

  function bizLabel(b) {
    var who = [b.first_name, b.last_name].filter(Boolean).join(' ');
    var parts = [b.structure, b.business_name || b.business_type, who ? 'של ' + who : ''].filter(Boolean);
    return S.esc(parts.join(' – ')) + (b.status === 'closed' ? ' <span class="side-pill">ריק – להשלים</span>' : '');
  }

  var placeLabel = S.placeLabel;

  // ---------- שדות הטופס ----------

  function field(k) { return form.querySelector('[data-field="' + k + '"]'); }

  function chips(k, values) {
    field(k).innerHTML = values.map(function (v) {
      return '<label><input type="radio" name="' + k + '" value="' + S.esc(v) + '">' + S.esc(v) + '</label>';
    }).join('');
  }
  chips('structure', S.STRUCTURES);
  chips('business_type', S.BUSINESS_TYPES);
  chips('tenure', S.TENURES);

  function getRadio(k) { var r = field(k).querySelector('input:checked'); return r ? r.value : ''; }
  function setRadio(k, v) { field(k).querySelectorAll('input').forEach(function (r) { r.checked = r.value === v; }); }

  var TEXT_FIELDS = ['first_name', 'last_name', 'phone', 'business_name', 'street', 'house', 'stall', 'linked_to', 'note'];

  function sideOf(house) {
    var n = parseInt(house, 10);
    return isNaN(n) ? '' : (n % 2 ? 'אי-זוגי' : 'זוגי');
  }

  function updateSide() {
    var street = field('street').value.trim(), house = field('house').value.trim();
    var side = sideOf(house), info = '';
    if (side) info = 'צד ' + side;
    if (street && house && !state.addrIndex[street + '|' + house]) info += (info ? ' · ' : '') + 'הכתובת לא ברשימה - במפה תסומן לפי ה-GPS';
    $('sideInfo').textContent = info;
    renderExisting();
  }
  field('street').addEventListener('input', updateSide);
  field('house').addEventListener('input', updateSide);

  function renderExisting() {
    var box = $('existingHere');
    if (!state.mode) { box.innerHTML = ''; return; }
    var street = field('street').value.trim(), house = field('house').value.trim();
    if (!street || !house) { box.innerHTML = ''; return; }
    var rows = state.server.businesses.filter(function (b) {
      return b.street === street && String(b.house) === house && (!state.editing || b.id !== state.editing.id);
    });
    box.innerHTML = rows.length ? '<p class="muted" style="margin-bottom:0">כבר דווחו בכתובת הזו:</p>' + rows.map(function (b) {
      return '<div class="list-item"><span>' + bizLabel(b) + (b.stall ? '<br><span class="muted">' + S.esc(b.stall) + '</span>' : '') + '</span></div>';
    }).join('') : '';
  }

  // תמונה
  var photoFile = null;
  $('f_photo').onchange = function () {
    photoFile = $('f_photo').files[0] || null;
    var prev = $('photoPrev');
    if (!photoFile) { prev.classList.add('hidden'); form.querySelector('.cam-text').textContent = 'צילום'; return; }
    prev.src = URL.createObjectURL(photoFile); prev.classList.remove('hidden');
    form.querySelector('.cam-text').textContent = 'צילום מחדש';
  };

  // ---------- פתיחת טופס ----------

  var TITLES = { full: 'עסק חדש', empty: 'עסק ריק', complete: 'השלמת עסק' };

  function openForm(mode, preset) {
    preset = preset || {};
    state.mode = mode;
    state.editing = mode === 'complete' ? preset : null;
    form.dataset.mode = mode === 'complete' ? 'full' : mode;
    $('formTitle').textContent = TITLES[mode];
    TEXT_FIELDS.forEach(function (k) { field(k).value = preset[k] != null ? preset[k] : ''; });
    ['structure', 'business_type', 'tenure'].forEach(function (k) { setRadio(k, preset[k] || ''); });
    $('f_photo').value = ''; photoFile = null;
    $('photoPrev').classList.add('hidden');
    form.querySelector('.cam-text').textContent = 'צילום';
    $('formErr').textContent = '';
    $('saveActions').classList.toggle('hidden', mode === 'complete');
    $('completeActions').classList.toggle('hidden', mode !== 'complete');
    $('homeView').classList.add('hidden');
    $('formView').classList.remove('hidden');
    showTab('report');
    updateSide();
    window.scrollTo({ top: 0 });

    // GPS פתיחה
    var visit = state.visit = { id: S.uid(), gpsOpen: undefined };
    $('gpsInfo').textContent = 'מאתר מיקום…';
    S.gps().then(function (g) {
      if (state.visit !== visit) return;
      visit.gpsOpen = g;
      $('gpsInfo').textContent = g ? 'מיקום נשמר (±' + g.acc + ' מ\')' : 'אין מיקום GPS';
    });
  }

  function closeForm() {
    state.mode = null; state.editing = null; state.visit = null;
    $('formView').classList.add('hidden');
    $('homeView').classList.remove('hidden');
    window.scrollTo({ top: 0 });
  }

  document.querySelectorAll('[data-start]').forEach(function (b) {
    b.onclick = function () { openForm(b.dataset.start); };
  });
  $('cancelForm').onclick = function () {
    if (state.mode !== 'complete' && TEXT_FIELDS.some(function (k) { return field(k).value.trim(); }) &&
      !confirm('לבטל? מה שמילאת לא יישמר.')) return;
    var wasComplete = state.mode === 'complete';
    closeForm();
    if (wasComplete) showTab('pending');
  };

  // ---------- קריאה ושמירה ----------

  function readForm() {
    var full = form.dataset.mode === 'full';
    var rec = {
      structure: getRadio('structure'),
      street: field('street').value.trim(),
      house: field('house').value.trim(),
      stall: field('stall').value.trim(),
      business_name: field('business_name').value.trim(),
      business_type: getRadio('business_type'),
      note: field('note').value.trim(),
      status: full ? 'filled' : 'closed'
    };
    rec.side = sideOf(rec.house);
    if (full) {
      ['first_name', 'last_name', 'phone', 'linked_to'].forEach(function (k) { rec[k] = field(k).value.trim(); });
      rec.tenure = getRadio('tenure');
    }
    var errs = [];
    if (!rec.structure) errs.push('חסר: בסטה או חנות');
    if (!rec.street && !rec.stall) errs.push('חסר: רחוב או תיאור מיקום');
    if (full && !rec.business_name && !rec.first_name) errs.push('חסר: שם העסק או שם פרטי');
    if (rec.phone && !/^[0-9+\-\s()]{7,}$/.test(rec.phone)) errs.push('מספר הטלפון לא תקין');
    return { rec: rec, errs: errs };
  }

  function gpsFields(go, gc) {
    go = go || {}; gc = gc || {};
    return {
      gps_open_lat: go.lat, gps_open_lng: go.lng, gps_open_acc: go.acc,
      gps_close_lat: gc.lat, gps_close_lng: gc.lng, gps_close_acc: gc.acc
    };
  }

  var saving = false;
  function setSaving(on) {
    saving = on;
    document.querySelectorAll('[data-next],[data-complete]').forEach(function (b) { b.disabled = on; });
  }

  function save(next) {
    if (saving) return;
    $('formErr').textContent = '';
    var r = readForm();
    if (r.errs.length) {
      $('formErr').innerHTML = r.errs.map(S.esc).join('<br>');
      $('formErr').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setSaving(true);
    var visit = state.visit || { id: S.uid() };
    var editing = state.editing, mode = state.mode;
    var photoP = photoFile ? S.resizeImage(photoFile) : Promise.resolve(null);

    Promise.all([photoP, S.gps(4000)]).then(function (res) {
      var rec = Object.assign(r.rec, gpsFields(visit.gpsOpen, res[1]));
      if (res[0]) rec.photo = res[0];
      var label = placeLabel(rec) + (rec.business_name ? ' - ' + rec.business_name : '');

      if (editing) {
        return S.enqueue({ action: 'updateBusiness', id: editing.id, business: rec }, 'השלמה: ' + label).then(function () {
          Object.assign(editing, rec, { photo: undefined });
          toast('ההשלמה נשמרה');
          closeForm(); renderPending(); showTab('pending');
        });
      }

      rec.client_id = S.uid();
      var payload = Object.assign({ action: 'submitVisit', visit_id: visit.id, businesses: [rec],
        street: rec.street, house: rec.house, side: rec.side, stall: rec.stall }, gpsFields(visit.gpsOpen, res[1]));
      return S.enqueue(payload, label).then(function () {
        // מקומית, כדי שיופיע מיד ב"כבר דווחו" ובהשלמה האוטומטית גם בלי רשת
        state.server.businesses.push(Object.assign({ id: '' }, rec, { photo: undefined }));
        renderLinkedList();
        toast('נשמר: ' + label);
        if (next === 'similar') openForm(mode === 'empty' ? 'empty' : 'full', { street: rec.street, linked_to: rec.linked_to });
        else if (next === 'empty') openForm('empty', { street: rec.street });
        else openForm('full');
      });
    }).catch(function (e) { $('formErr').textContent = e.message; })
      .finally(function () { setSaving(false); });
  }
  document.querySelectorAll('[data-next]').forEach(function (b) { b.onclick = function () { save(b.dataset.next); }; });
  document.querySelector('[data-complete]').onclick = function () { save(null); };

  // ---------- להשלים ----------

  function renderPending() {
    var rows = state.server.businesses.filter(function (b) { return b.status === 'closed' && b.id; });
    rows.sort(function (x, y) {
      return String(x.street || '').localeCompare(y.street || '', 'he') || S.cmpHouse(String(x.house), String(y.house));
    });
    $('pendingCount').textContent = rows.length ? '(' + rows.length + ')' : '';
    if (!rows.length) { $('pendingList').innerHTML = 'אין כרגע עסקים להשלמה.'; return; }
    $('pendingList').innerHTML = rows.map(function (b) {
      return '<div class="list-item"><span><b>' + S.esc(placeLabel(b)) + '</b> · ' + S.esc([b.structure, b.business_name].filter(Boolean).join(' – ')) +
        (b.note ? '<br><span class="muted">' + S.esc(b.note) + '</span>' : '') +
        (b.photo_url && /^https?:/.test(b.photo_url) ? ' <a href="' + S.esc(b.photo_url) + '" target="_blank" rel="noopener">📷</a>' : '') +
        '<br><span class="muted">סומן ע"י ' + S.esc(b.created_by || '') + '</span></span>' +
        '<button class="btn small" data-edit="' + S.esc(b.id) + '">השלמה</button></div>';
    }).join('');
    $('pendingList').querySelectorAll('[data-edit]').forEach(function (btn) {
      btn.onclick = function () {
        var b = state.server.businesses.filter(function (x) { return x.id === btn.dataset.edit; })[0];
        if (b) openForm('complete', b);
      };
    });
  }
  $('refreshBtn').onclick = function () { refresh().then(function () { toast('עודכן'); }); };

  // ---------- טעינה ----------

  S.loadJSON('data/addresses.json').then(function (rows) {
    var streets = {};
    rows.forEach(function (a) { state.addrIndex[a.street + '|' + a.house] = a; streets[a.street] = 1; });
    $('streetList').innerHTML = Object.keys(streets).sort(function (a, b) {
      return (a !== 'הכרמל') - (b !== 'הכרמל') || a.localeCompare(b, 'he');
    }).map(function (s) { return '<option value="' + S.esc(s) + '">'; }).join('');
  });
  if (S.getCode()) showApp(); else showLogin();
})();
