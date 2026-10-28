/* מפה + ייצוא. */
(function () {
  'use strict';
  var S = window.Shuk;
  var $ = function (id) { return document.getElementById(id); };
  var MAIN_STREET = 'הכרמל';
  var COLORS = { none: '#9aa0a6', ok: '#2f7d4f', warn: '#c27a12', junction: '#2b6cb0' };

  var addresses = [], junctionsCalc = [], data = { businesses: [], junctions: [] };
  var map, layer;

  function key(street, house) { return street + '|' + house; }

  function showLogin() {
    $('loginView').classList.remove('hidden');
    $('topBar').classList.add('hidden'); $('mapWrap').classList.add('hidden');
  }
  $('loginBtn').onclick = function () {
    $('loginErr').textContent = '';
    S.login($('loginCode').value).then(start, function (e) { $('loginErr').textContent = e.message; });
  };
  $('loginCode').onkeydown = function (e) { if (e.key === 'Enter') $('loginBtn').click(); };

  function start() {
    $('loginView').classList.add('hidden');
    $('topBar').classList.remove('hidden'); $('mapWrap').classList.remove('hidden');
    if (!map) {
      map = L.map('map', { zoomControl: true }).setView([32.0678, 34.7678], 18);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 20, maxNativeZoom: 16, attribution: 'Esri'
      }).addTo(map);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 20, maxNativeZoom: 16
      }).addTo(map);
      layer = L.layerGroup().addTo(map);
    }
    load();
  }

  function load() {
    return Promise.all([
      addresses.length ? null : S.loadJSON('data/addresses.json').then(function (a) { addresses = a; }),
      junctionsCalc.length ? null : S.loadJSON('data/junctions.json').then(function (j) { junctionsCalc = j; }),
      S.apiGet({ code: S.getCode() }).then(function (j) { data = { businesses: j.businesses || [], junctions: j.junctions || [] }; })
    ]).then(function () { fillFilters(); render(); }, function (e) {
      if (e.auth) { S.logout(); showLogin(); } else alert('שגיאה בטעינה: ' + e.message);
    });
  }

  function fillFilters() {
    function opts(sel, values) {
      var cur = sel.value;
      sel.innerHTML = '<option value="">הכול</option>' + values.map(function (v) { return '<option>' + S.esc(v) + '</option>'; }).join('');
      sel.value = cur;
    }
    var linked = {};
    data.businesses.forEach(function (b) { if (b.linked_to) linked[b.linked_to] = 1; });
    opts($('fType'), S.BUSINESS_TYPES);
    opts($('fLinked'), Object.keys(linked).sort());
    opts($('fStructure'), S.STRUCTURES);
  }
  ['fType', 'fLinked', 'fStructure'].forEach(function (id) { $(id).onchange = render; });
  $('reloadBtn').onclick = load;

  function filtered() {
    var t = $('fType').value, l = $('fLinked').value, st = $('fStructure').value;
    return data.businesses.filter(function (b) {
      return (!t || b.business_type === t) && (!l || b.linked_to === l) && (!st || b.structure === st);
    });
  }

  function bizLine(b) {
    var who = [b.first_name, b.last_name].filter(Boolean).join(' ');
    var s = [b.structure, b.business_name || b.business_type, who ? 'של ' + who : ''].filter(Boolean).join(' – ');
    if (b.status === 'closed') s += ' (סגור – להשלים)';
    return S.esc(s) + (b.photo_url && /^https?:/.test(b.photo_url) ? ' <a href="' + S.esc(b.photo_url) + '" target="_blank" rel="noopener">📷</a>' : '');
  }

  function render() {
    layer.clearLayers();
    var anyFilter = $('fType').value || $('fLinked').value || $('fStructure').value;
    var biz = filtered();
    var byAddr = {};
    biz.forEach(function (b) { (byAddr[key(b.street, String(b.house))] = byAddr[key(b.street, String(b.house))] || []).push(b); });
    var addrIndex = {};
    addresses.forEach(function (a) { addrIndex[key(a.street, a.house)] = a; });

    // נקודות: כל כתובות הכרמל + כל כתובת אחרת שיש בה דיווח
    var shown = addresses.filter(function (a) { return a.street === MAIN_STREET || byAddr[key(a.street, a.house)]; });
    var bounds = [];
    shown.forEach(function (a) {
      var list = byAddr[key(a.street, a.house)] || [];
      if (anyFilter && !list.length) return;
      var color = !list.length ? COLORS.none : list.some(function (b) { return b.status === 'closed'; }) ? COLORS.warn : COLORS.ok;
      var m = L.circleMarker([a.lat, a.lng], { radius: list.length ? 8 : 5, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: .95 });
      m.bindTooltip(S.esc(a.street + ' ' + a.house) + (list.length ? ' · ' + list.length : ''), { direction: 'top' });
      m.bindPopup('<b>' + S.esc(a.street + ' ' + a.house) + '</b> · ' + a.side +
        (list.length ? '<ul>' + list.map(function (b) { return '<li>' + bizLine(b) + '</li>'; }).join('') + '</ul>' : '<br><span class="muted">לא נסקר</span>'));
      m.addTo(layer);
      if (a.street === MAIN_STREET) bounds.push([a.lat, a.lng]);
    });
    if (!map._fitted && bounds.length) { map.fitBounds(bounds, { padding: [20, 20] }); map._fitted = true; }

    // צמתים: שאושרו בשטח (מלא) / מחושבים בלבד (ריק)
    var confirmed = {};
    data.junctions.forEach(function (j) { confirmed[j.cross_street] = j; });
    junctionsCalc.forEach(function (j) {
      var ok = confirmed[j.cross_street];
      L.circleMarker([j.lat, j.lng], { radius: 7, color: COLORS.junction, weight: 2, fillColor: COLORS.junction, fillOpacity: ok ? .9 : 0 })
        .bindTooltip('צומת ' + S.esc(j.cross_street) + (ok ? '' : ' (לא אושר)'), { direction: 'top' }).addTo(layer);
    });
    data.junctions.forEach(function (j) {
      if (junctionsCalc.some(function (c) { return c.cross_street === j.cross_street; })) return;
      var lat = +j.lat, lng = +j.lng;
      if (!lat || !lng) return;
      L.circleMarker([lat, lng], { radius: 7, color: COLORS.junction, weight: 2, fillColor: COLORS.junction, fillOpacity: .9 })
        .bindTooltip('צומת ' + S.esc(j.cross_street) + ' (ידני)', { direction: 'top' }).addTo(layer);
    });

    // טבלה צדדית
    var keys = Object.keys(byAddr).sort(function (x, y) {
      var a = x.split('|'), b = y.split('|');
      return (a[0] !== MAIN_STREET) - (b[0] !== MAIN_STREET) || a[0].localeCompare(b[0], 'he') || S.cmpHouse(a[1], b[1]);
    });
    $('addrTable').innerHTML = keys.length ? '<table class="biz">' + keys.map(function (k) {
      var p = k.split('|'), a = addrIndex[k];
      return '<tr><th' + (a ? ' data-ll="' + a.lat + ',' + a.lng + '" style="cursor:pointer;text-decoration:underline"' : '') + '>' + S.esc(p[0] + ' ' + p[1]) + '</th><td>' +
        byAddr[k].map(bizLine).join('<br>') + '</td></tr>';
    }).join('') + '</table>' : '<p class="muted">אין דיווחים' + (anyFilter ? ' שמתאימים לסינון' : '') + '.</p>';
    $('addrTable').querySelectorAll('[data-ll]').forEach(function (th) {
      th.onclick = function () { map.setView(th.dataset.ll.split(',').map(Number), 19); };
    });

    var filledN = data.businesses.filter(function (b) { return b.status !== 'closed'; }).length;
    var closedN = data.businesses.length - filledN;
    var carmelDone = addresses.filter(function (a) {
      return a.street === MAIN_STREET && data.businesses.some(function (b) { return b.street === a.street && String(b.house) === a.house; });
    }).length;
    var carmelAll = addresses.filter(function (a) { return a.street === MAIN_STREET; }).length;
    $('stats').textContent = filledN + ' עסקים · ' + closedN + ' להשלים · ' + carmelDone + '/' + carmelAll + ' כתובות בכרמל';
  }

  // ---------- ייצוא ----------

  var BIZ_COLS = [
    ['street', 'רחוב'], ['house', 'מספר'], ['side', 'צד'], ['status', 'סטטוס'],
    ['structure', 'סוג המבנה'], ['business_name', 'שם העסק'], ['business_type', 'סוג העסק'],
    ['first_name', 'שם פרטי'], ['last_name', 'שם משפחה'], ['phone', 'טלפון'], ['tenure', 'שוכר/בעלים'],
    ['linked_to', 'מקושר ל-'], ['note', 'הערה'], ['photo_url', 'תמונה'],
    ['gps_open_lat', 'GPS פתיחה lat'], ['gps_open_lng', 'GPS פתיחה lng'], ['gps_open_acc', 'GPS פתיחה דיוק'],
    ['gps_close_lat', 'GPS סגירה lat'], ['gps_close_lng', 'GPS סגירה lng'], ['gps_close_acc', 'GPS סגירה דיוק'],
    ['created_by', 'מילא/ה'], ['created_at', 'נוצר'], ['updated_by', 'עודכן ע"י'], ['updated_at', 'עודכן'],
    ['id', 'מזהה'], ['visit_id', 'מזהה ביקור']
  ];
  var J_COLS = [['street', 'רחוב'], ['cross_street', 'רחוב חוצה'], ['side', 'צד'], ['between_from', 'בין מספר'],
    ['between_to', 'לבין מספר'], ['note', 'הערה'], ['lat', 'lat'], ['lng', 'lng'], ['created_by', 'מילא/ה'], ['created_at', 'נוצר']];

  function sheet(rows, cols) {
    return XLSX.utils.aoa_to_sheet([cols.map(function (c) { return c[1]; })].concat(rows.map(function (r) {
      return cols.map(function (c) {
        var v = r[c[0]];
        if (c[0] === 'status') v = S.STATUS_LABEL[v] || v;
        return v == null ? '' : v;
      });
    })));
  }

  function sortedBiz() {
    return filtered().slice().sort(function (x, y) {
      return (x.street !== MAIN_STREET) - (y.street !== MAIN_STREET) || String(x.street).localeCompare(y.street, 'he') ||
        S.cmpHouse(String(x.house), String(y.house));
    });
  }

  function stamp() { return new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'); }

  $('xlsxBtn').onclick = function () {
    var wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, sheet(sortedBiz(), BIZ_COLS), 'עסקים');
    XLSX.utils.book_append_sheet(wb, sheet(data.junctions, J_COLS), 'צמתים');
    XLSX.writeFile(wb, 'shuk-hacarmel-' + stamp() + '.xlsx');
  };

  $('jsonBtn').onclick = function () {
    var blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), businesses: sortedBiz(), junctions: data.junctions }, null, 2)],
      { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'shuk-hacarmel-' + stamp() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
  };

  if (S.getCode()) start(); else showLogin();
})();
