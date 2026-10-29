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

  function typeText(b) {
    return b.business_type === 'אחר' && b.business_type_other ? 'אחר: ' + b.business_type_other : (b.business_type || '');
  }

  function bizLine(b) {
    var who = [b.first_name, b.last_name].filter(Boolean).join(' ');
    var s = [b.structure, b.business_name || typeText(b), who ? 'של ' + who : ''].filter(Boolean).join(' – ');
    if (b.status === 'closed') s += ' (ריק – להשלים)';
    if (b.stall) s += ' · ' + b.stall;
    return S.esc(s);
  }

  // מיקום עסק: נקודת הכתובת אם היא ברשימה, אחרת ה-GPS מפתיחת הטופס
  function bizPoint(b, addrIndex) {
    var a = b.street && addrIndex[key(b.street, String(b.house))];
    if (a) return { lat: a.lat, lng: a.lng, byAddr: true };
    var lat = +(b.gps_open_lat || b.gps_close_lat || b.loc_lat), lng = +(b.gps_open_lng || b.gps_close_lng || b.loc_lng);
    return lat && lng ? { lat: lat, lng: lng, byAddr: false } : null;
  }

  function render() {
    layer.clearLayers();
    var anyFilter = $('fType').value || $('fLinked').value || $('fStructure').value;
    var biz = filtered();
    var addrIndex = {};
    addresses.forEach(function (a) { addrIndex[key(a.street, a.house)] = a; });

    // סמן לכל עסק. כמה עסקים באותה נקודה נפרשים בעיגול קטן (~3 מ') כדי שאפשר יהיה ללחוץ על כל אחד
    var groups = {};
    biz.forEach(function (b) {
      var p = bizPoint(b, addrIndex);
      b._pt = p;
      if (!p) return;
      var k = p.lat.toFixed(5) + ',' + p.lng.toFixed(5);
      (groups[k] = groups[k] || []).push(b);
    });
    var bounds = [];
    Object.keys(groups).forEach(function (k) {
      var list = groups[k], n = list.length;
      list.forEach(function (b, i) {
        var lat = b._pt.lat, lng = b._pt.lng;
        if (n > 1) {
          var ang = 2 * Math.PI * i / n, r = 3 + n * 0.4;     // מטרים
          lat += r * Math.cos(ang) / 111320;
          lng += r * Math.sin(ang) / (111320 * Math.cos(lat * Math.PI / 180));
        }
        var color = b.status === 'closed' ? COLORS.warn : COLORS.ok;
        var shape = b._pt.byAddr ? '50%' : '3px';
        var m = L.marker([lat, lng], { icon: L.divIcon({ className: '', iconSize: [16, 16],
          html: '<div class="bizdot" style="border-radius:' + shape + ';background:' + color + '"></div>' }) });
        m.bindTooltip(bizLine(b), { direction: 'top' });
        m.on('click', function () { openCard(b); });
        m.addTo(layer);
        bounds.push([lat, lng]);
      });
    });
    if (!map._fitted) {
      if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 19 });
      map._fitted = true;
    }

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

    // טבלה צדדית: עסקים לפי כתובת. לחיצה על שורה פותחת את הכרטיס
    var rows = biz.slice().sort(function (x, y) {
      return (x.street !== MAIN_STREET) - (y.street !== MAIN_STREET) || String(x.street || '~').localeCompare(y.street || '~', 'he') ||
        S.cmpHouse(String(x.house), String(y.house));
    });
    $('addrTable').innerHTML = rows.length ? '<table class="biz">' + rows.map(function (b, i) {
      return '<tr data-i="' + i + '" class="clickable"><th>' + S.esc([b.street, b.house].filter(Boolean).join(' ') || 'בלי רחוב') +
        '</th><td>' + bizLine(b) + (b._pt ? '' : ' <span class="muted">(בלי מיקום)</span>') + '</td></tr>';
    }).join('') + '</table>' : '<p class="muted">אין דיווחים' + (anyFilter ? ' שמתאימים לסינון' : '') + '.</p>';
    $('addrTable').querySelectorAll('tr[data-i]').forEach(function (tr) {
      tr.onclick = function () {
        var b = rows[+tr.dataset.i];
        if (b._pt) map.setView([b._pt.lat, b._pt.lng], Math.max(map.getZoom(), 19));
        openCard(b);
      };
    });

    var closedN = data.businesses.filter(function (b) { return b.status === 'closed'; }).length;
    $('stats').textContent = data.businesses.length + ' עסקים · ' + closedN + ' להשלים';
  }

  // ---------- כרטיס עסק ----------

  function openCard(b) {
    var who = [b.first_name, b.last_name].filter(Boolean).join(' ');
    var rows = [
      ['סטטוס', S.STATUS_LABEL[b.status] || b.status],
      ['בסטה / חנות', b.structure],
      ['שם העסק', b.business_name],
      ['סוג העסק', typeText(b)],
      ['שם', who],
      ['טלפון', b.phone ? '<a href="tel:' + S.esc(String(b.phone).replace(/[^0-9+]/g, '')) + '">' + S.esc(b.phone) + '</a>' : '', true],
      ['שוכר / בעלים', b.tenure],
      ['כתובת', [b.street, b.house].filter(Boolean).join(' ') + (b.side ? ' (' + b.side + ')' : '')],
      ['תיאור מיקום', b.stall],
      ['מקושר ל-', b.linked_to],
      ['הערה', b.note],
      ['מילא/ה', [b.created_by, fmtDate(b.created_at)].filter(Boolean).join(' · ')],
      ['עודכן', [b.updated_by, fmtDate(b.updated_at)].filter(Boolean).join(' · ')]
    ].filter(function (r) { return r[1]; });
    $('card').innerHTML = '<div class="addr-head"><h3>' + S.esc(b.business_name || typeText(b) || b.structure || 'עסק') + '</h3>' +
      '<button class="btn ghost small" id="cardClose">סגירה</button></div>' +
      '<div id="cardPhoto" class="card-photo"></div>' +
      '<table class="kv">' + rows.map(function (r) {
        return '<tr><th>' + r[0] + '</th><td>' + (r[2] ? r[1] : S.esc(r[1])) + '</td></tr>';
      }).join('') + '</table>' +
      (b._pt && !b._pt.byAddr ? '<p class="muted small">ממוקם במפה לפי ה-GPS (הכתובת לא ברשימה)</p>' : '');
    $('card').classList.remove('hidden');
    document.body.classList.add('card-open');
    $('cardClose').onclick = closeCard;

    var box = $('cardPhoto');
    if (!b.photo_url) { box.innerHTML = '<p class="muted">אין תמונה</p>'; return; }
    box.innerHTML = '<p class="muted">טוען תמונה…</p>';
    S.loadPhoto(b.photo_url).then(function (src) {
      if ($('cardPhoto') !== box) return;
      box.innerHTML = '';
      var img = document.createElement('img');
      img.src = src; img.alt = 'תמונת העסק';
      img.onclick = function () { var w = window.open(); if (w) w.document.write('<img src="' + src + '" style="max-width:100%">'); };
      box.appendChild(img);
    }, function () {
      // שרת שעוד לא עודכן: קישור לדרייב (נפתח רק לבעל החשבון)
      box.innerHTML = /^https?:/.test(b.photo_url)
        ? '<a href="' + S.esc(b.photo_url) + '" target="_blank" rel="noopener">📷 פתיחת התמונה בדרייב</a>'
        : '<p class="muted">התמונה לא נטענה</p>';
    });
  }
  function closeCard() { $('card').classList.add('hidden'); document.body.classList.remove('card-open'); }
  function fmtDate(v) {
    if (!v) return '';
    var d = new Date(v);
    return isNaN(d) ? String(v) : d.toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
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
    ['structure', 'סוג המבנה'], ['business_name', 'שם העסק'], ['business_type', 'סוג העסק'], ['business_type_other', 'פירוט סוג אחר'],
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
