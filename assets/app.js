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
    $('settingsLink').classList.toggle('hidden', !S.isAdmin());
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
      if (j.settings) S.cacheSettings(j.settings);
      if ('admin' in j) S.setAdmin(j.admin);
      $('settingsLink').classList.toggle('hidden', !S.isAdmin());
      if (state.mode) applySettings();
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

  var TEXT_FIELDS = ['first_name', 'last_name', 'phone', 'business_name', 'business_type_other', 'street', 'house', 'stall', 'linked_to', 'note'];
  var RADIO_FIELDS = ['structure', 'business_type', 'tenure'];
  var OTHER = 'אחר';

  // ---------- הגדרות חובה / רשות / לא מוצג ----------

  function formKey() { return state.mode === 'empty' ? 'empty' : 'full'; }
  function modeOf(k) { return S.getSettings()[formKey()][k]; }
  function fld(k) { return form.querySelector('.fld[data-key="' + k + '"]'); }

  function applySettings() {
    form.querySelectorAll('.fld').forEach(function (el) {
      var k = el.dataset.key, m = modeOf(k);
      var hidden = m === 'hide' || (k === 'business_type_other' && getRadio('business_type') !== OTHER);
      el.classList.toggle('hidden', hidden);
      var label = el.querySelector('label.f');
      if (!label) return;
      var mark = label.querySelector('.mark');
      if (!mark) { mark = document.createElement('span'); mark.className = 'mark'; label.appendChild(mark); }
      mark.className = 'mark ' + (m === 'req' ? 'req' : 'opt');
      mark.textContent = m === 'req' ? ' *' : ' (רשות)';
    });
  }

  // "אחר" בסוג העסק פותח תיבת פירוט
  field('business_type').addEventListener('change', function () {
    if (getRadio('business_type') !== OTHER) field('business_type_other').value = '';
    applySettings();
    if (getRadio('business_type') === OTHER) field('business_type_other').focus();
  });

  // ---------- סימון שדות חסרים ----------

  function clearErrors() {
    form.querySelectorAll('.fld.invalid').forEach(function (el) { el.classList.remove('invalid'); });
    form.querySelectorAll('.ferr').forEach(function (el) { el.remove(); });
    $('formErr').textContent = '';
  }
  function clearFieldError(el) {
    el.classList.remove('invalid');
    var e = el.querySelector('.ferr'); if (e) e.remove();
    if (!form.querySelector('.fld.invalid')) $('formErr').textContent = '';
  }
  form.addEventListener('input', function (e) { var el = e.target.closest('.fld'); if (el) clearFieldError(el); });
  form.addEventListener('change', function (e) { var el = e.target.closest('.fld'); if (el) clearFieldError(el); });

  function showErrors(errs) {
    clearErrors();
    errs.forEach(function (er) {
      var el = fld(er.key);
      el.classList.add('invalid');
      var m = document.createElement('div'); m.className = 'ferr'; m.textContent = er.msg;
      el.appendChild(m);
    });
    $('formErr').textContent = errs.length === 1 ? 'חסר שדה אחד – מסומן באדום' : 'יש ' + errs.length + ' שדות לתיקון – מסומנים באדום';
    var first = fld(errs[0].key);
    first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var input = first.querySelector('input:not([type=file]):not([type=radio]), textarea');
    if (input) setTimeout(function () { input.focus({ preventScroll: true }); }, 350);
  }

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

  // ---------- תמונה: מצלמה אחורית בתוך הדף ----------

  var photoFile = null;
  function setPhoto(file) {
    photoFile = file || null;
    var prev = $('photoPrev');
    if (!photoFile) { prev.classList.add('hidden'); form.querySelector('.cam-text').textContent = 'צילום'; return; }
    prev.src = URL.createObjectURL(photoFile); prev.classList.remove('hidden');
    form.querySelector('.cam-text').textContent = 'צילום מחדש';
    clearFieldError(fld('photo'));
  }
  $('f_gallery').onchange = function () { setPhoto($('f_gallery').files[0]); };
  $('f_capture').onchange = function () { setPhoto($('f_capture').files[0]); };

  var cam = { stream: null, facing: 'environment' };
  function stopCamera() {
    if (cam.stream) cam.stream.getTracks().forEach(function (t) { t.stop(); });
    cam.stream = null;
    $('camModal').classList.add('hidden');
  }
  function startCamera() {
    if (cam.stream) cam.stream.getTracks().forEach(function (t) { t.stop(); });
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: cam.facing }, width: { ideal: 2560 }, height: { ideal: 1440 } }, audio: false
    }).then(function (stream) {
      cam.stream = stream;
      $('camVideo').srcObject = stream;
      $('camModal').classList.remove('hidden');
    });
  }
  $('camBtn').onclick = function () {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $('f_capture').click(); return; }
    cam.facing = 'environment';
    startCamera().catch(function () {
      // אין הרשאה / אין מצלמה - חוזרים לבחירת קובץ של המכשיר
      toast('המצלמה לא נפתחה - עוברים למצלמה של המכשיר');
      $('f_capture').click();
    });
  };
  $('camSwitch').onclick = function () {
    cam.facing = cam.facing === 'environment' ? 'user' : 'environment';
    startCamera().catch(function () { toast('לא ניתן להחליף מצלמה'); });
  };
  $('camCancel').onclick = stopCamera;
  $('camShoot').onclick = function () {
    var v = $('camVideo');
    if (!v.videoWidth) return;
    var c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    c.toBlob(function (blob) { stopCamera(); setPhoto(blob); }, 'image/jpeg', 0.92);
  };

  // ---------- פתיחת טופס ----------

  var TITLES = { full: 'עסק חדש', empty: 'עסק ריק', complete: 'השלמת עסק' };

  function openForm(mode, preset) {
    preset = preset || {};
    state.mode = mode;
    state.editing = mode === 'complete' ? preset : null;
    form.dataset.mode = formKey();
    $('formTitle').textContent = TITLES[mode];
    TEXT_FIELDS.forEach(function (k) { field(k).value = preset[k] != null ? preset[k] : ''; });
    RADIO_FIELDS.forEach(function (k) { setRadio(k, preset[k] || ''); });
    $('f_gallery').value = ''; $('f_capture').value = ''; setPhoto(null);
    clearErrors();
    applySettings();
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
    var rec = { status: state.mode === 'empty' ? 'closed' : 'filled' };
    var errs = [];
    S.FIELDS.forEach(function (f) {
      var k = f.key, m = modeOf(k);
      if (m === 'hide' || k === 'photo') return;
      if (k === 'business_type_other' && rec.business_type !== OTHER) return;
      rec[k] = RADIO_FIELDS.indexOf(k) >= 0 ? getRadio(k) : field(k).value.trim();
      if (m === 'req' && !rec[k]) errs.push({ key: k, msg: 'חסר: ' + f.label });
    });
    if (modeOf('photo') === 'req' && !photoFile) errs.push({ key: 'photo', msg: 'חסרה תמונה' });
    if (rec.phone && !/^[0-9+\-\s()]{7,}$/.test(rec.phone)) errs.push({ key: 'phone', msg: 'מספר הטלפון לא תקין' });
    rec.side = sideOf(rec.house || '');
    // סדר השגיאות לפי סדר השדות בטופס
    var order = S.FIELDS.map(function (f) { return f.key; });
    errs.sort(function (a, b) { return order.indexOf(a.key) - order.indexOf(b.key); });
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
    var r = readForm();
    if (r.errs.length) { showErrors(r.errs); return; }
    clearErrors();
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
