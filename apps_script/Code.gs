/**
 * צד השרת של מיפוי שוק הכרמל.
 * רץ כ-Google Apps Script שמחובר לגיליון (Extensions → Apps Script),
 * ונפרס כ-Web App. הוראות מלאות ב-README.md.
 *
 * כל בקשה חייבת לשאת קוד אישי שמופיע בלשונית "users" עם active=TRUE.
 */

var SHEET_USERS = 'users';
var SHEET_BUSINESSES = 'businesses';
var SHEET_JUNCTIONS = 'junctions';
var SHEET_SETTINGS = 'settings';
var PHOTO_FOLDER_NAME = 'תמונות';
// הגיליון. ריק = הגיליון שהסקריפט מחובר אליו (Extensions → Apps Script).
var SPREADSHEET_ID = '1s67VqWINNlnxRNc-venxtaeFsSk-Yamh4Kxqj_KcbwY';
// התיקייה בדרייב שאליה נשמרות התמונות. ריק = נוצרת אוטומטית ב-setup.
var PHOTO_FOLDER_ID = '1kv6NWlrT108b8jtoh_jgm2wcUHXoj1HO';

// [מפתח, כותרת בגיליון]. סדר העמודות בגיליון = סדר המערך.
var BUSINESS_COLS = [
  ['id', 'מזהה'],
  ['visit_id', 'מזהה ביקור'],
  ['street', 'רחוב'],
  ['house', 'מספר'],
  ['side', 'צד'],
  ['area', 'אזור'],
  ['stall', 'תיאור מיקום / דוכן'],
  ['loc_lat', 'מיקום lat'],
  ['loc_lng', 'מיקום lng'],
  ['status', 'סטטוס'],
  ['first_name', 'שם פרטי'],
  ['last_name', 'שם משפחה'],
  ['phone', 'טלפון'],
  ['business_name', 'שם העסק'],
  ['business_type', 'סוג העסק'],
  ['structure', 'סוג המבנה'],
  ['tenure', 'שוכר/בעלים'],
  ['linked_to', 'מקושר ל-'],
  ['note', 'הערה'],
  ['photo_url', 'תמונה'],
  ['gps_open_lat', 'GPS פתיחה lat'],
  ['gps_open_lng', 'GPS פתיחה lng'],
  ['gps_open_acc', 'GPS פתיחה דיוק (מ\')'],
  ['gps_close_lat', 'GPS סגירה lat'],
  ['gps_close_lng', 'GPS סגירה lng'],
  ['gps_close_acc', 'GPS סגירה דיוק (מ\')'],
  ['created_by', 'מילא/ה'],
  ['created_at', 'נוצר'],
  ['updated_by', 'עודכן ע"י'],
  ['updated_at', 'עודכן'],
  ['client_id', 'client_id'],
  // עמודות שנוספו בהמשך - תמיד בסוף, כדי לא להזיז עמודות קיימות
  ['business_type_other', 'פירוט סוג אחר'],
  ['home_city', 'מאיפה הסוחר'],
  ['commute', 'איך מגיע'],
  ['shuttle', 'שאטל']
];

var JUNCTION_COLS = [
  ['id', 'מזהה'],
  ['street', 'רחוב'],
  ['cross_street', 'רחוב חוצה'],
  ['note', 'הערה'],
  ['lat', 'lat'],
  ['lng', 'lng'],
  ['created_by', 'מילא/ה'],
  ['created_at', 'נוצר'],
  ['client_id', 'client_id']
];

// שדות שהלקוח רשאי לכתוב בעסק (השאר נקבעים בשרת)
var BUSINESS_WRITABLE = ['business_type_other', 'home_city', 'commute', 'shuttle', 'street', 'house', 'side', 'area', 'stall', 'loc_lat', 'loc_lng', 'status', 'first_name', 'last_name', 'phone',
  'business_name', 'business_type', 'structure', 'tenure', 'linked_to', 'note',
  'gps_open_lat', 'gps_open_lng', 'gps_open_acc', 'gps_close_lat', 'gps_close_lng', 'gps_close_acc'];

function ss_() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActive();
}

/** להריץ פעם אחת מתוך העורך: יוצר לשוניות, כותרות ותיקיית תמונות. */
function setup() {
  var ss = ss_();
  ensureSheet_(ss, SHEET_USERS, ['שם', 'קוד', 'פעיל', 'מנהל']);
  ensureSheet_(ss, SHEET_BUSINESSES, BUSINESS_COLS.map(function (c) { return c[1]; }));
  ensureSheet_(ss, SHEET_JUNCTIONS, JUNCTION_COLS.map(function (c) { return c[1]; }));
  var users = ss.getSheetByName(SHEET_USERS);
  if (users.getLastRow() < 2) {
    users.appendRow(['אייל', randomCode_(), true, true]);
  }
  photoFolder_();
  Logger.log('מוכן. הקוד הראשון נמצא בלשונית users.');
}

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sh.setRightToLeft(true);
  }
  return sh;
}

function randomCode_() {
  var abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  var s = '';
  for (var i = 0; i < 8; i++) s += abc.charAt(Math.floor(Math.random() * abc.length));
  return s;
}

function photoFolder_() {
  if (PHOTO_FOLDER_ID) return DriveApp.getFolderById(PHOTO_FOLDER_ID);
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* נמחקה - יוצרים מחדש */ }
  }
  var folder = DriveApp.createFolder(PHOTO_FOLDER_NAME);
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

// ---------- HTTP ----------

function doGet(e) {
  return handle_(function () {
    var p = e.parameter || {};
    var user = auth_(p.code);
    if (p.action === 'ping') return { ok: true, user: user, admin: isAdmin_(p.code) };
    if (p.action === 'photo') return { ok: true, data: photoData_(p.id) };
    return {
      ok: true,
      user: user,
      admin: isAdmin_(p.code),
      settings: readSettings_(),
      businesses: readAll_(SHEET_BUSINESSES, BUSINESS_COLS),
      junctions: readAll_(SHEET_JUNCTIONS, JUNCTION_COLS)
    };
  });
}

function doPost(e) {
  return handle_(function () {
    var body = JSON.parse(e.postData.contents);
    var user = auth_(body.code);
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      if (body.action === 'submitVisit') return submitVisit_(user, body);
      if (body.action === 'updateBusiness') return updateBusiness_(user, body);
      if (body.action === 'addJunction') return addJunction_(user, body);
      if (body.action === 'deleteJunction') return deleteJunction_(body);
      if (body.action === 'saveSettings') return saveSettings_(body);
      throw new Error('פעולה לא מוכרת');
    } finally {
      lock.releaseLock();
    }
  });
}

function handle_(fn) {
  var out;
  try {
    out = fn();
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function auth_(code) {
  code = String(code || '').trim();
  if (!code) throw new Error('AUTH');
  var rows = ss_().getSheetByName(SHEET_USERS).getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var active = rows[i][2] === true || String(rows[i][2]).toUpperCase() === 'TRUE';
    if (String(rows[i][1]).trim() === code && active) return String(rows[i][0]);
  }
  throw new Error('AUTH');
}

// עמודה רביעית בלשונית users: "מנהל" (TRUE/FALSE)
function isAdmin_(code) {
  code = String(code || '').trim();
  var rows = ss_().getSheetByName(SHEET_USERS).getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).trim() !== code) continue;
    var v = rows[i][3];
    return v === true || String(v).toUpperCase() === 'TRUE';
  }
  return false;
}

// ---------- הגדרות הטופס (חובה / רשות / לא מוצג) ----------

function settingsSheet_() {
  var ss = ss_();
  var sh = ss.getSheetByName(SHEET_SETTINGS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_SETTINGS);
    sh.getRange(1, 1).setValue('הגדרות הטופס (JSON) - נערך מעמוד ההגדרות באתר');
  }
  return sh;
}

function readSettings_() {
  var sh = ss_().getSheetByName(SHEET_SETTINGS);
  if (!sh) return null;
  var v = String(sh.getRange(2, 1).getValue() || '');
  if (!v) return null;
  try { return JSON.parse(v); } catch (e) { return null; }
}

function saveSettings_(body) {
  if (!isAdmin_(body.code)) throw new Error('רק מנהל יכול לשנות הגדרות');
  var s = body.settings;
  if (!s || typeof s !== 'object') throw new Error('הגדרות לא תקינות');
  settingsSheet_().getRange(2, 1).setValue(JSON.stringify(s));
  return { ok: true };
}

// ---------- תמונה (רק למי שיש קוד פעיל) ----------

function photoData_(id) {
  id = String(id || '');
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) throw new Error('מזהה תמונה לא תקין');
  var file = DriveApp.getFileById(id);
  var folderId = photoFolder_().getId();
  var parents = file.getParents(), ok = false;
  while (parents.hasNext()) if (parents.next().getId() === folderId) ok = true;
  if (!ok) throw new Error('התמונה לא בתיקיית התמונות');
  var blob = file.getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

// ---------- פעולות ----------

function submitVisit_(user, body) {
  var sh = ss_().getSheetByName(SHEET_BUSINESSES);
  var existing = columnValues_(sh, BUSINESS_COLS, 'client_id');
  var now = new Date();
  var visitId = body.visit_id || Utilities.getUuid();
  var saved = [];
  (body.businesses || []).forEach(function (b) {
    if (b.client_id && existing[b.client_id]) {   // שליחה חוזרת מהתור - כבר נשמר
      saved.push(existing[b.client_id]);
      return;
    }
    var rec = pick_(b, BUSINESS_WRITABLE);
    ['street', 'house', 'side', 'area', 'stall', 'loc_lat', 'loc_lng', 'gps_open_lat', 'gps_open_lng', 'gps_open_acc',
      'gps_close_lat', 'gps_close_lng', 'gps_close_acc'].forEach(function (k) {
      if (rec[k] === undefined || rec[k] === '') rec[k] = body[k];
    });
    rec.id = Utilities.getUuid().slice(0, 8);
    rec.visit_id = visitId;
    rec.status = rec.status === 'closed' ? 'closed' : 'filled';
    rec.photo_url = b.photo ? savePhoto_(b.photo, rec) : '';
    rec.created_by = user;
    rec.created_at = now;
    rec.client_id = b.client_id || '';
    sh.appendRow(toRow_(rec, BUSINESS_COLS));
    saved.push(rec.id);
  });
  return { ok: true, ids: saved, visit_id: visitId };
}

function updateBusiness_(user, body) {
  var sh = ss_().getSheetByName(SHEET_BUSINESSES);
  var idCol = colIndex_(BUSINESS_COLS, 'id');
  var ids = sh.getRange(1, idCol + 1, sh.getLastRow(), 1).getValues();
  for (var r = 1; r < ids.length; r++) {
    if (String(ids[r][0]) !== String(body.id)) continue;
    var range = sh.getRange(r + 1, 1, 1, BUSINESS_COLS.length);
    var row = range.getValues()[0];
    var rec = fromRow_(row, BUSINESS_COLS, true);
    var upd = pick_(body.business || {}, BUSINESS_WRITABLE);
    Object.keys(upd).forEach(function (k) { if (upd[k] !== undefined) rec[k] = upd[k]; });
    rec.status = rec.status === 'closed' ? 'closed' : 'filled';
    if (body.business && body.business.photo) rec.photo_url = savePhoto_(body.business.photo, rec);
    rec.updated_by = user;
    rec.updated_at = new Date();
    range.setValues([toRow_(rec, BUSINESS_COLS)]);
    return { ok: true, id: rec.id };
  }
  throw new Error('העסק לא נמצא');
}

function addJunction_(user, body) {
  var sh = ss_().getSheetByName(SHEET_JUNCTIONS);
  var j = body.junction || {};
  var existing = columnValues_(sh, JUNCTION_COLS, 'client_id');
  if (j.client_id && existing[j.client_id]) return { ok: true, id: existing[j.client_id] };
  var rec = pick_(j, ['street', 'cross_street', 'note', 'lat', 'lng']);
  rec.id = Utilities.getUuid().slice(0, 8);
  rec.created_by = user;
  rec.created_at = new Date();
  rec.client_id = j.client_id || '';
  sh.appendRow(toRow_(rec, JUNCTION_COLS));
  return { ok: true, id: rec.id };
}

function deleteJunction_(body) {
  var sh = ss_().getSheetByName(SHEET_JUNCTIONS);
  var idCol = colIndex_(JUNCTION_COLS, 'id') + 1;
  var last = sh.getLastRow();
  if (last < 2) return { ok: true };
  var ids = sh.getRange(2, idCol, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === String(body.id)) sh.deleteRow(i + 2);
  }
  return { ok: true };
}

function savePhoto_(dataUrl, rec) {
  var m = /^data:(image\/[a-z+]+);base64,(.*)$/.exec(String(dataUrl));
  if (!m) return '';
  var where = rec.street ? rec.street + '_' + rec.house : (rec.area || '') + '_' + (rec.stall || '');
  var name = [where, rec.business_name || rec.structure || '', rec.id].join('_') + '.jpg';
  var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name);
  var file = photoFolder_().createFile(blob);
  return file.getUrl();
}

// ---------- עזר לגיליון ----------

function colIndex_(cols, key) {
  for (var i = 0; i < cols.length; i++) if (cols[i][0] === key) return i;
  return -1;
}

function pick_(obj, keys) {
  var out = {};
  keys.forEach(function (k) { if (obj[k] !== undefined) out[k] = typeof obj[k] === 'string' ? obj[k].trim() : obj[k]; });
  return out;
}

function toRow_(rec, cols) {
  return cols.map(function (c) {
    var v = rec[c[0]];
    if (v === undefined || v === null) return '';
    // מניעת פרשנות של טקסט כנוסחה (=, +, -, @) ושמירה על אפס מוביל בטלפון
    if (typeof v === 'string' && /^[=+\-@0]/.test(v)) return "'" + v;
    return v;
  });
}

function fromRow_(row, cols, keepDates) {
  var rec = {};
  cols.forEach(function (c, i) {
    var v = row[i];
    rec[c[0]] = v instanceof Date && !keepDates ? v.toISOString() : v;
  });
  return rec;
}

function readAll_(name, cols) {
  var sh = ss_().getSheetByName(name);
  var rows = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    if (rows[i].join('') === '') continue;
    out.push(fromRow_(rows[i], cols));
  }
  return out;
}

function columnValues_(sh, cols, key) {
  var map = {};
  var last = sh.getLastRow();
  if (last < 2) return map;
  var kc = colIndex_(cols, key) + 1;
  var ic = colIndex_(cols, 'id') + 1;
  var keys = sh.getRange(2, kc, last - 1, 1).getValues();
  var ids = sh.getRange(2, ic, last - 1, 1).getValues();
  for (var i = 0; i < keys.length; i++) if (keys[i][0]) map[keys[i][0]] = ids[i][0];
  return map;
}
