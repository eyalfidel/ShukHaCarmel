/* עמוד ההגדרות: טבלת חובה / רשות / לא מוצג לכל שדה ולכל סוג טופס. */
(function () {
  'use strict';
  var S = window.Shuk;
  var $ = function (id) { return document.getElementById(id); };
  var forms = Object.keys(S.FORMS);

  function render(settings, editable) {
    $('tbl').querySelector('thead tr').innerHTML = '<th>שדה</th>' + forms.map(function (f) { return '<th>' + S.esc(S.FORMS[f]) + '</th>'; }).join('');
    $('tbl').querySelector('tbody').innerHTML = S.FIELDS.map(function (f) {
      return '<tr><th>' + S.esc(f.label) + (f.note ? '<div class="muted small">' + S.esc(f.note) + '</div>' : '') + '</th>' +
        forms.map(function (form) {
          var v = settings[form][f.key];
          return '<td><select data-form="' + form + '" data-key="' + f.key + '" class="m-' + v + '"' + (editable ? '' : ' disabled') + '>' +
            Object.keys(S.MODES).map(function (m) {
              return '<option value="' + m + '"' + (m === v ? ' selected' : '') + '>' + S.MODES[m] + '</option>';
            }).join('') + '</select></td>';
        }).join('') + '</tr>';
    }).join('');
    $('tbl').querySelectorAll('select').forEach(function (sel) {
      sel.onchange = function () { sel.className = 'm-' + sel.value; };
    });
    $('tbl').classList.remove('hidden');
    $('acts').classList.toggle('hidden', !editable);
  }

  function read() {
    var out = {};
    forms.forEach(function (f) { out[f] = {}; });
    $('tbl').querySelectorAll('select').forEach(function (sel) { out[sel.dataset.form][sel.dataset.key] = sel.value; });
    return out;
  }

  if (!S.getCode()) {
    $('msg').innerHTML = 'צריך להיכנס קודם <a href="index.html">בטופס</a>.';
    return;
  }
  S.apiGet({ code: S.getCode() }).then(function (j) {
    if (j.settings) S.cacheSettings(j.settings);
    if ('admin' in j) S.setAdmin(j.admin);
    var admin = S.isAdmin();
    $('msg').textContent = admin ? '' : 'רק מנהל יכול לשנות את ההגדרות. אפשר לראות אותן כאן.';
    render(S.getSettings(), admin);
  }, function (e) {
    $('msg').textContent = 'לא הצלחתי לטעון מהשרת (' + e.message + '). מוצגות ההגדרות האחרונות שנשמרו במכשיר.';
    render(S.getSettings(), false);
  });

  $('saveBtn').onclick = function () {
    var s = read(), btn = $('saveBtn');
    btn.disabled = true; $('err').textContent = '';
    S.apiPost({ action: 'saveSettings', settings: s, code: S.getCode() }).then(function (r) {
      if (r && r.ok === false) throw new Error(r.error);
      S.cacheSettings(s);
      $('msg').textContent = 'נשמר ✓';
    }).catch(function (e) {
      $('err').textContent = /פעולה לא מוכרת/.test(e.message) ? 'השרת עוד לא עודכן - צריך להדביק את Code.gs החדש ולפרוס גרסה חדשה.' : e.message;
    }).finally(function () { btn.disabled = false; });
  };
  $('resetBtn').onclick = function () {
    var d = {};
    forms.forEach(function (form) { d[form] = {}; S.FIELDS.forEach(function (f) { d[form][f.key] = f[form]; }); });
    render(d, true);
    $('msg').textContent = 'הוחזרה ברירת המחדל - לחצו "שמירה" כדי להחיל.';
  };
})();
