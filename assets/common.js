/* קוד משותף לטופס ולמפה: תקשורת עם השרת, קוד אישי, תור לא-מקוון, קבועים. */
(function () {
  'use strict';

  var CFG = window.SHUK_CONFIG || {};
  var CODE_KEY = 'shuk.code';
  var USER_KEY = 'shuk.user';

  var BUSINESS_TYPES = ['הסעדה', 'מזון', 'מסחר', 'אחר'];
  var STRUCTURES = ['בסטה', 'חנות'];
  var TENURES = ['שוכר', 'בעלים'];
  var STATUS_LABEL = { filled: 'מולא', closed: 'סגור – להשלים' };

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { } }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  // ---------- שרת ----------

  function isMock() { return !CFG.API_URL || CFG.API_URL === 'mock'; }

  function apiGet(params) {
    if (isMock()) return Promise.resolve(Mock.get(params));
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    return fetch(CFG.API_URL + '?' + qs, { redirect: 'follow' }).then(parse);
  }

  function apiPost(body) {
    if (isMock()) return Promise.resolve(Mock.post(body));
    // בלי Content-Type מפורש = text/plain, כך שאין preflight של CORS מול Apps Script
    return fetch(CFG.API_URL, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' }).then(parse);
  }

  function parse(res) {
    return res.text().then(function (t) {
      var j;
      try { j = JSON.parse(t); } catch (e) { throw new Error('תשובה לא תקינה מהשרת'); }
      if (!j.ok) {
        var err = new Error(j.error === 'AUTH' ? 'קוד לא מוכר או לא פעיל' : j.error);
        err.auth = j.error === 'AUTH';
        err.server = true;
        throw err;
      }
      return j;
    });
  }

  // ---------- מצב הדגמה (בלי שרת) ----------

  var Mock = {
    load: function () {
      try { return JSON.parse(lsGet('shuk.mockdb')) || { businesses: [], junctions: [] }; } catch (e) { return { businesses: [], junctions: [] }; }
    },
    save: function (db) { lsSet('shuk.mockdb', JSON.stringify(db)); },
    user: function (code) {
      if (!code) return { ok: false, error: 'AUTH' };
      return null;
    },
    get: function (p) {
      var bad = Mock.user(p.code); if (bad) return bad;
      var db = Mock.load();
      return { ok: true, user: 'הדגמה (' + p.code + ')', businesses: db.businesses, junctions: db.junctions };
    },
    post: function (b) {
      var bad = Mock.user(b.code); if (bad) return bad;
      var db = Mock.load(), now = new Date().toISOString(), who = 'הדגמה (' + b.code + ')';
      if (b.action === 'submitVisit') {
        var visit = b.visit_id || uid(), ids = [];
        b.businesses.forEach(function (x) {
          var dup = db.businesses.filter(function (r) { return x.client_id && r.client_id === x.client_id; })[0];
          if (dup) { ids.push(dup.id); return; }
          var rec = Object.assign({}, x);
          ['street', 'house', 'side', 'gps_open_lat', 'gps_open_lng', 'gps_open_acc', 'gps_close_lat', 'gps_close_lng', 'gps_close_acc']
            .forEach(function (k) { if (rec[k] === undefined || rec[k] === '') rec[k] = b[k]; });
          rec.id = uid().slice(0, 8); rec.visit_id = visit;
          rec.photo_url = x.photo ? '(תמונה בהדגמה)' : ''; delete rec.photo;
          rec.created_by = who; rec.created_at = now;
          db.businesses.push(rec); ids.push(rec.id);
        });
        Mock.save(db);
        return { ok: true, ids: ids, visit_id: visit };
      }
      if (b.action === 'updateBusiness') {
        var r = db.businesses.filter(function (x) { return x.id === b.id; })[0];
        if (!r) return { ok: false, error: 'העסק לא נמצא' };
        var upd = Object.assign({}, b.business);
        if (upd.photo) { r.photo_url = '(תמונה בהדגמה)'; }
        delete upd.photo;
        Object.assign(r, upd, { updated_by: who, updated_at: now });
        Mock.save(db);
        return { ok: true, id: r.id };
      }
      if (b.action === 'addJunction') {
        var j = Object.assign({}, b.junction, { id: uid().slice(0, 8), created_by: who, created_at: now });
        db.junctions.push(j); Mock.save(db);
        return { ok: true, id: j.id };
      }
      return { ok: false, error: 'פעולה לא מוכרת' };
    }
  };

  // ---------- קוד אישי ----------

  function getCode() { return lsGet(CODE_KEY); }
  function getUser() { return lsGet(USER_KEY); }
  function login(code) {
    code = String(code || '').trim();
    return apiGet({ action: 'ping', code: code }).then(function (j) {
      lsSet(CODE_KEY, code); lsSet(USER_KEY, j.user);
      return j.user;
    });
  }
  function logout() { lsSet(CODE_KEY, null); lsSet(USER_KEY, null); }

  // ---------- תור לא-מקוון (IndexedDB) ----------

  var dbp = null;
  function idb() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var req = indexedDB.open('shuk-outbox', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('outbox', { keyPath: 'qid' }); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbp;
  }
  function store(mode) {
    return idb().then(function (db) { return db.transaction('outbox', mode).objectStore('outbox'); });
  }
  function reqP(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }

  var listeners = [];
  function notify() { queueList().then(function (items) { listeners.forEach(function (fn) { fn(items); }); }); }
  function onQueueChange(fn) { listeners.push(fn); notify(); }

  function queueList() {
    return store('readonly').then(function (s) { return reqP(s.getAll()); })
      .then(function (items) { return items.sort(function (a, b) { return a.created - b.created; }); })
      .catch(function () { return []; });
  }

  function enqueue(payload, label) {
    var item = { qid: uid(), created: Date.now(), label: label || '', payload: payload };
    return store('readwrite').then(function (s) { return reqP(s.put(item)); })
      .then(function () { notify(); flush(); return item; });
  }

  var flushing = false, lastError = null;
  function flush() {
    if (flushing) return Promise.resolve();
    flushing = true;
    return queueList().then(function loop(items) {
      if (!items.length) { lastError = null; return; }
      var it = items[0];
      var body = Object.assign({}, it.payload, { code: getCode() });
      return apiPost(body).then(function () {
        return store('readwrite').then(function (s) { return reqP(s.delete(it.qid)); })
          .then(function () { notify(); return queueList().then(loop); });
      }, function (err) {
        lastError = err;
        if (err.server && !err.auth) {
          // השרת דחה את הפריט עצמו - מסמנים אותו ולא תוקעים את כל התור
          it.error = err.message;
          return store('readwrite').then(function (s) { return reqP(s.put(it)); }).then(notify);
        }
      });
    }).finally(function () { flushing = false; notify(); });
  }

  function dropQueued(qid) {
    return store('readwrite').then(function (s) { return reqP(s.delete(qid)); }).then(notify);
  }

  window.addEventListener('online', flush);
  setInterval(flush, 30000);

  // ---------- GPS ----------

  function gps() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(function (p) {
        resolve({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy) });
      }, function () { resolve(null); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
    });
  }

  // ---------- תמונה: הקטנה לפני שליחה ----------

  function resizeImage(file, maxSide, quality) {
    maxSide = maxSide || 1280; quality = quality || 0.75;
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var s = Math.min(1, maxSide / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('לא ניתן לקרוא את התמונה')); };
      img.src = url;
    });
  }

  // ---------- עזר ----------

  function houseKey(h) {
    var m = /^\s*(\d+)\s*(.*)$/.exec(h || '');
    return m ? [parseInt(m[1], 10), m[2]] : [1e6, h || ''];
  }
  function cmpHouse(a, b) {
    var x = houseKey(a), y = houseKey(b);
    return x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function loadJSON(path) { return fetch(path).then(function (r) { return r.json(); }); }

  window.Shuk = {
    BUSINESS_TYPES: BUSINESS_TYPES, STRUCTURES: STRUCTURES, TENURES: TENURES, STATUS_LABEL: STATUS_LABEL,
    isMock: isMock, apiGet: apiGet, apiPost: apiPost,
    getCode: getCode, getUser: getUser, login: login, logout: logout,
    enqueue: enqueue, flush: flush, queueList: queueList, onQueueChange: onQueueChange, dropQueued: dropQueued,
    lastError: function () { return lastError; },
    gps: gps, resizeImage: resizeImage, uid: uid, cmpHouse: cmpHouse, esc: esc, loadJSON: loadJSON
  };
})();
