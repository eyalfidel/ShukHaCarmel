/* השלמה אוטומטית לשמות רחובות: חיפוש סלחני (כתיב מלא/חסר, תארים, סדר מילים, גרשיים)
   ורשימה נפתחת ידידותית למגע במקום ה-datalist של הדפדפן. */
(function () {
  'use strict';

  // מילים שלא משנות את זהות הרחוב
  var STOP = ['רחוב', 'רח', 'שדרות', 'שדרת', 'שד', 'סמטת', 'סמטה', 'סמ', 'דרך', 'כיכר', 'ככר', 'מעבר',
    'הרב', 'הרבי', 'רבי', 'ר', 'רב', 'דר', 'דוקטור', 'פרופ', 'פרופסור', 'מר', 'גברת', 'המשורר', 'הסופר'];
  var FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };

  function clean(s) {
    return String(s || '').normalize('NFKC')
      .replace(/[״”“"׳’‘'`.]/g, '')
      .replace(/[\-–־,()/]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  // שלד של מילה: בלי י/ו (כתיב מלא/חסר), אותיות סופיות כרגילות, ק=כ ט=ת, בלי ה' הידיעה
  var SOUND = { 'ק': 'כ', 'ט': 'ת' };
  function skel(w) {
    w = w.replace(/[ךםןףץ]/g, function (c) { return FINALS[c]; }).replace(/[קט]/g, function (c) { return SOUND[c]; });
    if (w.length > 3 && w.charAt(0) === 'ה') w = w.slice(1);
    if (w.length > 2) w = w.replace(/ה$/, 'א');
    var first = w.charAt(0);
    return first + w.slice(1).replace(/[יו]/g, '');
  }
  function words(s) {
    return clean(s).split(' ').filter(function (t) { return t && STOP.indexOf(t) < 0; });
  }
  function tokens(s) { return words(s).map(skel); }
  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      var rowMin = i;
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  // ציון התאמה של שאילתה לשם רשמי. 0 = לא מתאים
  function score(qt, entry, partialLast) {
    if (!qt.length) return 0;
    var nt = entry.t, used = [], total = 0;
    for (var i = 0; i < qt.length; i++) {
      var q = qt[i], best = 0, bestJ = -1, last = partialLast && i === qt.length - 1;
      for (var j = 0; j < nt.length; j++) {
        if (used[j]) continue;
        var n = nt[j], s = 0;
        if (n === q) s = 10;
        else if (n.indexOf(q) === 0 && (last || q.length >= 3)) s = 6 + Math.min(3, q.length) / 2;
        else if (q.length >= 4 && lev(q, n, q.length >= 6 ? 2 : 1) <= (q.length >= 6 ? 2 : 1)) s = 5;
        else if (q.length >= 4 && n.length > q.length && lev(q, n.slice(0, q.length), 1) <= 1) s = 3;
        if (s > best) { best = s; bestJ = j; }
      }
      if (!best) return 0;
      used[bestJ] = true; total += best;
    }
    // עדיפות לשם שכל מילותיו כוסו, ולשמות קצרים
    var unmatched = nt.length - qt.length;
    return total - unmatched * 1.5;
  }

  // aliases: { 'כינוי': 'שם רשמי' } - שמות שהעין לא מוצאת (קינג ג'ורג' = המלך ג'ורג')
  function Matcher(names, priority, aliases) {
    var pr = {};
    this.aliases = {};
    var al = this.aliases;
    Object.keys(aliases || {}).forEach(function (k) { al[tokens(k).join(' ')] = aliases[k]; });
    (priority || []).forEach(function (n, i) { pr[n] = i + 1; });
    this.priority = priority || [];
    this.entries = names.map(function (n) { return { name: n, t: tokens(n), pr: pr[n] || 0, key: clean(n) }; });
    this.exact = {};
    var self = this;
    this.entries.forEach(function (e) { self.exact[e.key] = e.name; });
  }
  Matcher.prototype.search = function (q, limit, partialLast) {
    limit = limit || 8;
    var qt = tokens(q);
    if (!qt.length) return this.priority.slice(0, limit);
    var res = [], alias = this.aliases[qt.join(' ')];
    if (alias) res.push({ name: alias, s: 1000 });
    this.entries.forEach(function (e) {
      var s = score(qt, e, partialLast !== false);
      if (s > 0 && e.name !== alias) res.push({ name: e.name, s: s + (e.pr ? 4 : 0) });
    });
    res.sort(function (a, b) { return b.s - a.s || a.name.length - b.name.length; });
    return res.slice(0, limit).map(function (r) { return r.name; });
  };
  // הצעת תיקון למה שהוקלד: null אם כבר רשמי, או { name, sure } עם ההתאמה הטובה ביותר
  Matcher.prototype.correct = function (q) {
    var key = clean(q);
    if (!key || this.exact[key]) return null;
    var qt = tokens(q), qs = qt.slice().sort().join(' ');
    if (this.aliases[qt.join(' ')]) return { name: this.aliases[qt.join(' ')], sure: true };
    // התאמה זהה עד כדי כתיב/תארים/סדר מילים = תיקון בטוח,
    // אלא אם יש רחוב ליד השוק שמכיל את אותן מילים (שפר → רבינוביץ שפ"ר, לא שיפר)
    var same = this.entries.filter(function (e) { return e.t.slice().sort().join(' ') === qs; });
    var nearRival = this.entries.some(function (e) {
      return e.pr && same.indexOf(e) < 0 && qt.every(function (t) { return e.t.indexOf(t) >= 0; });
    });
    // כמה שמות עם אותו שלד (השומר / שמיר): מכריע הכתיב המדויק
    if (same.length > 1) {
      var raw = words(q).sort().join(' ');
      var exactSpelling = same.filter(function (e) { return words(e.name).sort().join(' ') === raw; });
      if (exactSpelling.length === 1) same = exactSpelling;
    }
    if (same.length === 1 && !nearRival) return { name: same[0].name, sure: true };
    var top = this.search(q, 3, false);
    if (!top.length) return null;
    return { name: top[0], options: top, sure: false };
  };

  // ---------- רשימה נפתחת ----------

  function attach(input, matcher, opts) {
    opts = opts || {};
    input.removeAttribute('list');
    input.setAttribute('autocomplete', 'off');
    var wrap = document.createElement('div');
    wrap.className = 'ac-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    var list = document.createElement('div');
    list.className = 'ac-list hidden';
    wrap.appendChild(list);
    var hint = document.createElement('div');
    hint.className = 'ac-hint hidden';
    // ההודעה (תיקון / הצעות) ברוחב מלא - מתחת לאלמנט שנבחר, או מתחת לשדה
    var after = opts.hintAfter || wrap;
    after.parentNode.insertBefore(hint, after.nextSibling);
    var items = [], active = -1, prevValue = null;

    function render(names, heading) {
      items = names; active = -1;
      if (!names.length) { list.classList.add('hidden'); return; }
      list.innerHTML = (heading ? '<div class="ac-head">' + heading + '</div>' : '') + names.map(function (n, i) {
        return '<div class="ac-item" data-i="' + i + '">' + esc(n) + (matcher.entries.some(function (e) { return e.name === n && e.pr; }) ? ' <span class="ac-star">ליד השוק</span>' : '') + '</div>';
      }).join('');
      list.classList.remove('hidden');
    }
    function open() {
      var v = input.value;
      if (!clean(v)) render(matcher.priority.slice(0, 40), 'רחובות ליד השוק');
      else render(matcher.search(v, 8));
    }
    function choose(name) {
      prevValue = null;
      input.value = name;
      list.classList.add('hidden');
      hideHint();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      if (opts.onPick) opts.onPick(name);
    }
    function hideHint() { hint.classList.add('hidden'); hint.innerHTML = ''; }
    function check() {
      var v = input.value;
      if (!clean(v)) { hideHint(); return; }
      var c = matcher.correct(v);
      if (!c) { hideHint(); return; }
      if (c.sure) {
        // תיקון אוטומטי, עם אפשרות לבטל
        prevValue = v;
        input.value = c.name;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        hint.innerHTML = 'תוקן לשם הרשמי: <b>' + esc(c.name) + '</b> <button type="button" class="ac-undo">ביטול</button>';
        hint.classList.remove('hidden');
        hint.querySelector('.ac-undo').onclick = function () {
          input.value = prevValue; prevValue = null; hideHint();
          input.dispatchEvent(new Event('input', { bubbles: true }));
        };
        return;
      }
      hint.innerHTML = 'הרחוב לא מוכר. התכוונת ל: ' + c.options.map(function (n) {
        return '<button type="button" class="ac-chip">' + esc(n) + '</button>';
      }).join(' ') + ' <span class="muted">(או להשאיר כמו שכתוב)</span>';
      hint.classList.remove('hidden');
      hint.querySelectorAll('.ac-chip').forEach(function (b) { b.onclick = function () { choose(b.textContent); }; });
    }
    function setActive(i) {
      var els = list.querySelectorAll('.ac-item');
      els.forEach(function (el) { el.classList.remove('active'); });
      if (i >= 0 && els[i]) { els[i].classList.add('active'); els[i].scrollIntoView({ block: 'nearest' }); }
      active = i;
    }

    input.addEventListener('focus', function () { hideHint(); open(); });
    input.addEventListener('input', function (e) { if (e.isTrusted !== false && document.activeElement === input) open(); });
    input.addEventListener('keydown', function (e) {
      if (list.classList.contains('hidden')) return;
      if (e.key === 'ArrowDown') { setActive(Math.min(items.length - 1, active + 1)); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { setActive(Math.max(0, active - 1)); e.preventDefault(); }
      else if (e.key === 'Enter' && active >= 0) { choose(items[active]); e.preventDefault(); }
      else if (e.key === 'Escape') list.classList.add('hidden');
    });
    // pointerdown לפני blur, כדי שהבחירה תיתפס
    list.addEventListener('pointerdown', function (e) {
      var it = e.target.closest('.ac-item');
      if (it) { e.preventDefault(); choose(items[+it.dataset.i]); }
    });
    input.addEventListener('blur', function () {
      setTimeout(function () { list.classList.add('hidden'); check(); }, 120);
    });
    return { check: check, hideHint: hideHint };
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  window.ShukStreets = { Matcher: Matcher, attach: attach, _tokens: tokens };
})();
