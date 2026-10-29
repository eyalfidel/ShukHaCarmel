/* מפה, סימון צמתים, ייצוא. */
(function () {
  'use strict';
  var S = window.Shuk;
  var $ = function (id) { return document.getElementById(id); };
  var MAIN_STREET = 'הכרמל';
  var COLORS = { none: '#9aa0a6', ok: '#2f7d4f', warn: '#c27a12', junction: '#2b6cb0' };

  var addresses = [], data = { businesses: [], junctions: [] };
  var map, layer, marking = false;

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
      map = L.map('map', { zoomControl: true, maxZoom: 21 }).setView(S.CENTER, 18);
      S.baseLayers(map);
      layer = L.layerGroup().addTo(map);
      map.on('click', function (e) { if (marking) junctionForm(e.latlng); });
    }
    load();
  }

  function load() {
    return Promise.all([
      addresses.length ? null : S.loadJSON('data/addresses.json').then(function (a) {
        addresses = a;
        var streets = {};
        a.forEach(function (x) { streets[x.street] = 1; });
        $('streetList').innerHTML = Object.keys(streets).sort().map(function (n) { return '<option value="' + S.esc(n) + '">'; }).join('');
      }),
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
    if (b.status === 'closed') s += ' (ריק – להשלים)';
    if (b.stall) s += ' · ' + b.stall;
    return S.esc(s) + (b.photo_url && /^https?:/.test(b.photo_url) ? ' <a href="' + S.esc(b.photo_url) + '" target="_blank" rel="noopener">📷</a>' : '');
  }

  function render() {
    layer.clearLayers();
    var anyFilter = $('fType').value || $('fLinked').value || $('fStructure').value;
    var biz = filtered();
    var addrIndex = {};
    addresses.forEach(function (a) { addrIndex[key(a.street, a.house)] = a; });
    // עסק שהכתובת שלו ברשימה - על נקודת הכתובת. אחרת - לפי ה-GPS מפתיחת הטופס
    var byAddr = {}, byPoint = {};
    biz.forEach(function (b) {
      var k = key(b.street, String(b.house));
      if (b.street && addrIndex[k]) { (byAddr[k] = byAddr[k] || []).push(b); return; }
      var lat = +(b.gps_open_lat || b.gps_close_lat || b.loc_lat), lng = +(b.gps_open_lng || b.gps_close_lng || b.loc_lng);
      b._noPoint = !(lat && lng);
      if (b._noPoint) return;
      var pk = lat.toFixed(5) + ',' + lng.toFixed(5);
      (byPoint[pk] = byPoint[pk] || []).push(b);
    });

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

    // עסקים בלי כתובת מהרשימה - ריבוע לפי ה-GPS
    Object.keys(byPoint).forEach(function (k) {
      var list = byPoint[k], ll = k.split(',').map(Number);
      var color = list.some(function (b) { return b.status === 'closed'; }) ? COLORS.warn : COLORS.ok;
      L.marker(ll, { icon: L.divIcon({ className: '', iconSize: [14, 14],
        html: '<div style="width:14px;height:14px;border-radius:3px;border:1.5px solid #fff;background:' + color + '"></div>' }) })
        .bindTooltip(S.esc(S.placeLabel(list[0])), { direction: 'top' })
        .bindPopup('<b>לפי GPS</b><ul>' + list.map(function (b) {
          return '<li>' + S.esc([b.street, b.house].filter(Boolean).join(' ')) + ' ' + bizLine(b) + '</li>';
        }).join('') + '</ul>')
        .addTo(layer);
    });

    // צמתים שסומנו
    data.junctions.forEach(function (j) {
      var lat = +j.lat, lng = +j.lng;
      if (!lat || !lng) return;
      var m = L.circleMarker([lat, lng], { radius: 8, color: '#fff', weight: 2, fillColor: COLORS.junction, fillOpacity: .95 })
        .bindTooltip('צומת ' + S.esc(j.cross_street), { direction: 'top', permanent: true, className: 'jlabel' });
      var pop = document.createElement('div');
      pop.innerHTML = '<b>' + S.esc((j.street ? j.street + ' / ' : '') + j.cross_street) + '</b>' +
        (j.note ? '<br>' + S.esc(j.note) : '') + '<br><span class="muted">' + S.esc(j.created_by || '') + '</span>' +
        '<div class="actions"><button class="btn ghost small">מחיקת הצומת</button></div>';
      pop.querySelector('button').onclick = function () {
        if (!confirm('למחוק את הצומת ' + j.cross_street + '?')) return;
        S.apiPost({ action: 'deleteJunction', id: j.id, code: S.getCode() }).then(function () {
          data.junctions = data.junctions.filter(function (x) { return x !== j; });
          map.closePopup(); render();
        }, function (e) { alert(e.message); });
      };
      m.bindPopup(pop).addTo(layer);
    });

    // טבלה צדדית
    Object.keys(byPoint).forEach(function (pk) {
      byPoint[pk].forEach(function (b) {
        var k = (b.street || '~') + '|' + (b.house || '');
        b._ll = pk;
        (byAddr[k] = byAddr[k] || []).push(b);
      });
    });
    biz.forEach(function (b) {
      if (!b._noPoint) return;
      var k = (b.street || '~') + '|' + (b.house || '');
      (byAddr[k] = byAddr[k] || []).push(b);
    });
    var keys = Object.keys(byAddr).sort(function (x, y) {
      var a = x.split('|'), b = y.split('|');
      return (a[0] !== MAIN_STREET) - (b[0] !== MAIN_STREET) || a[0].localeCompare(b[0], 'he') || S.cmpHouse(a[1], b[1]);
    });
    $('addrTable').innerHTML = keys.length ? '<table class="biz">' + keys.map(function (k) {
      var p = k.split('|'), a = addrIndex[k], first = byAddr[k][0];
      var ll = a ? a.lat + ',' + a.lng : (first._ll || '');
      return '<tr><th' + (ll ? ' data-ll="' + ll + '" style="cursor:pointer;text-decoration:underline"' : '') + '>' +
        S.esc(first.street ? [p[0], p[1]].join(' ') : 'בלי רחוב') + '</th><td>' +
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

  // ---------- סימון צמתים ----------

  $('markBtn').onclick = function () {
    marking = !marking;
    $('markBtn').textContent = marking ? 'סיום סימון' : 'סימון צמתים';
    $('markBtn').classList.toggle('primary', marking);
    $('markHelp').classList.toggle('hidden', !marking);
    document.body.classList.toggle('mark-on', marking);
    if (marking && map.getZoom() < 18) map.setZoom(18);
  };

  function junctionForm(latlng) {
    var box = document.createElement('div');
    box.className = 'jform';
    box.innerHTML = '<b>צומת חדש</b>' +
      '<input type="text" class="js" list="streetList" value="' + MAIN_STREET + '" placeholder="רחוב ראשי">' +
      '<input type="text" class="jc" list="streetList" placeholder="רחוב חוצה / סמטה">' +
      '<input type="text" class="jn" placeholder="הערה (לא חובה)">' +
      '<div class="actions"><button class="btn primary small">שמירה</button></div><div class="err"></div>';
    var popup = L.popup({ minWidth: 220 }).setLatLng(latlng).setContent(box).openOn(map);
    setTimeout(function () { box.querySelector('.jc').focus(); }, 50);
    box.querySelector('button').onclick = function () {
      var rec = {
        street: box.querySelector('.js').value.trim(),
        cross_street: box.querySelector('.jc').value.trim(),
        note: box.querySelector('.jn').value.trim(),
        lat: +latlng.lat.toFixed(6), lng: +latlng.lng.toFixed(6),
        client_id: S.uid()
      };
      if (!rec.cross_street) { box.querySelector('.err').textContent = 'חסר שם רחוב חוצה'; return; }
      this.disabled = true;
      S.apiPost({ action: 'addJunction', junction: rec, code: S.getCode() }).then(function (r) {
        data.junctions.push(Object.assign({ id: r.id, created_by: S.getUser() }, rec));
        map.closePopup(popup); render();
      }, function (e) { box.querySelector('.err').textContent = e.message; box.querySelector('button').disabled = false; });
    };
  }

  // ---------- ייצוא ----------

  var BIZ_COLS = [
    ['street', 'רחוב'], ['house', 'מספר'], ['side', 'צד'], ['stall', 'תיאור מיקום'], ['status', 'סטטוס'],
    ['structure', 'סוג המבנה'], ['business_name', 'שם העסק'], ['business_type', 'סוג העסק'],
    ['first_name', 'שם פרטי'], ['last_name', 'שם משפחה'], ['phone', 'טלפון'], ['tenure', 'שוכר/בעלים'],
    ['linked_to', 'מקושר ל-'], ['note', 'הערה'], ['photo_url', 'תמונה'],
    ['gps_open_lat', 'GPS פתיחה lat'], ['gps_open_lng', 'GPS פתיחה lng'], ['gps_open_acc', 'GPS פתיחה דיוק'],
    ['gps_close_lat', 'GPS סגירה lat'], ['gps_close_lng', 'GPS סגירה lng'], ['gps_close_acc', 'GPS סגירה דיוק'],
    ['created_by', 'מילא/ה'], ['created_at', 'נוצר'], ['updated_by', 'עודכן ע"י'], ['updated_at', 'עודכן'],
    ['id', 'מזהה'], ['visit_id', 'מזהה ביקור']
  ];
  var J_COLS = [['street', 'רחוב'], ['cross_street', 'רחוב חוצה'], ['note', 'הערה'], ['lat', 'lat'], ['lng', 'lng'], ['created_by', 'מילא/ה'], ['created_at', 'נוצר']];

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
        String(x.stall || '').localeCompare(y.stall || '', 'he') ||
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
