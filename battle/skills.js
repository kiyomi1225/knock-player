/**
 * 苦手の見える化・今週のふり返り・記録の引っ越しのきまりごと（画面に依存しない）。
 * ブラウザでは window.HissanSkills、Node では module.exports。core.js（HissanCore）を使う。
 *
 *  - 手順（step）を「くり上がり」「借りる」「九九」などの技（skill）に分けて、
 *    つまずいた（まちがえた・？を見た）かどうかを技ごとに記録する
 *  - 苦手 = 最近の30回のうち、つまずいた割合が高い技（8回以上やったものだけ）
 *  - 日ごとの記録（hist）から、今週と先週をくらべる
 *  - 記録の引っ越しコード: 端末の記録を1本の文字にして、べつの端末で読みこむ
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.HissanSkills = factory(root.HissanCore);
})(this, function (C) {
  'use strict';

  var SKILLS = [
    { id: 'add_carry', op: 'add', name: 'たし算のくり上がり' },
    { id: 'add_basic', op: 'add', name: 'たし算（くり上がりなし）' },
    { id: 'sub_borrow', op: 'sub', name: 'ひき算の借りる' },
    { id: 'sub_basic', op: 'sub', name: 'ひき算（借りない）' },
    { id: 'mul_kuku', op: 'mul', name: 'かけ算の九九' },
    { id: 'mul_carry', op: 'mul', name: 'かけ算のくり上がり' },
    { id: 'mul_sum', op: 'mul', name: 'かけ算の答えのたし算' },
    { id: 'div_guess', op: 'div', name: 'わり算の商をたてる' },
    { id: 'div_prod', op: 'div', name: 'わり算の「かける」' },
    { id: 'div_diff', op: 'div', name: 'わり算の「ひく」' },
    { id: 'div_down', op: 'div', name: 'わり算の「おろす」' },
    { id: 'point', op: '', name: '小数点の位置' }
  ];
  var RECENT = 30, MIN_RECENT = 8, WEAK_RATE = 0.1, KEEP_DAYS = 70;

  function skillName(id) { for (var i = 0; i < SKILLS.length; i++) if (SKILLS[i].id === id) return SKILLS[i].name; return id; }

  /** その手順はどの技か */
  function skillOf(p, s) {
    if (s.type === 'point' || s.zero) return 'point';
    if (p.op === 'add') return s.type === 'carry' || s.carryIn || s.sum >= 10 ? 'add_carry' : 'add_basic';
    if (p.op === 'sub') return s.type === 'borrow' || s.top >= 10 ? 'sub_borrow' : 'sub_basic';
    if (p.op === 'mul') {
      if (s.type === 'mul') return s.carryIn ? 'mul_carry' : 'mul_kuku';
      if (s.type === 'mulcarry') return 'mul_carry';
      return 'mul_sum';
    }
    if (p.op === 'div') return { quot: 'div_guess', prod: 'div_prod', diff: 'div_diff', down: 'div_down' }[s.type] || 'div_diff';
    return 'add_basic';
  }

  function day(rec, key) {
    rec.hist = rec.hist || {};
    var d = rec.hist[key] = rec.hist[key] || { p: 0, ok: 0, h: 0, s: 0, ms: 0, sk: {} };
    d.sk = d.sk || {};
    return d;
  }
  /** 古い日を消す（keyは YYYY-MM-DD なので文字でくらべられる） */
  function trim(rec, todayKey) {
    var cut = addDays(todayKey, -KEEP_DAYS);
    Object.keys(rec.hist || {}).forEach(function (k) { if (k < cut) delete rec.hist[k]; });
  }

  /** 手順を1つ終えたときに呼ぶ。trouble = この手順でまちがえた・？を見た */
  function recordStep(rec, key, skill, trouble) {
    rec.sk = rec.sk || {};
    var k = rec.sk[skill] = rec.sk[skill] || { n: 0, m: 0, r: '' };
    k.n++; if (trouble) k.m++;
    k.r = (k.r + (trouble ? '1' : '0')).slice(-RECENT);
    var d = day(rec, key), ds = d.sk[skill] = d.sk[skill] || [0, 0];
    ds[0]++; if (trouble) ds[1]++;
  }
  /** 問題を1つ解き終えたとき */
  function recordProblem(rec, key, ok, helped) {
    var d = day(rec, key); d.p++; if (ok) d.ok++; if (helped) d.h++;
    trim(rec, key);
  }
  /** セットを解き終えたとき（かかった時間） */
  function recordSet(rec, key, ms) { var d = day(rec, key); d.s++; d.ms += Math.max(0, Math.min(ms, 3600000)); }

  /** 苦手の一覧（つまずいた割合が高い順） */
  function weakList(rec) {
    var sk = rec.sk || {}, out = [];
    SKILLS.forEach(function (s) {
      var k = sk[s.id]; if (!k || k.r.length < MIN_RECENT) return;
      var m = k.r.split('').filter(function (c) { return c === '1'; }).length, rate = m / k.r.length;
      if (rate >= WEAK_RATE) out.push({ id: s.id, name: s.name, rate: rate, recent: k.r.length, miss: m });
    });
    return out.sort(function (a, b) { return b.rate - a.rate || b.miss - a.miss; });
  }

  /** 苦手練習の問題: その技がたくさん出てくる問題を集める。base = {lv, dec} */
  function makeWeakSet(skill, base, rng, n) {
    n = n || 10;
    var sk = null; SKILLS.forEach(function (s) { if (s.id === skill) sk = s; });
    if (!sk) return [];
    var lv = base && base.lv === 3 ? 3 : 2, cands = [];
    for (var i = 0; i < 80; i++) {
      var op = sk.op || ['add', 'sub', 'mul', 'div'][Math.floor(rng() * 4)];
      var dec = skill === 'point' ? true : !!(base && base.dec);
      var p = op === 'div' ? (dec ? C.generateDecimalDiv(lv, rng) : C.generateDivProblem(lv, rng))
        : dec ? C.generateDecimalProblem(op, lv, rng) : C.generateProblem(op, lv, rng);
      var hits = C.buildSteps(p).filter(function (s) { return skillOf(p, s) === skill; }).length;
      if (hits > 0) cands.push({ p: p, hits: hits, tie: rng() });
    }
    var seen = {};
    return cands.sort(function (a, b) { return b.hits - a.hits || a.tie - b.tie; })
      .filter(function (c) { var k = c.p.op + c.p.a + '_' + c.p.b; if (seen[k]) return false; seen[k] = 1; return true; })
      .slice(0, n).map(function (c) { return c.p; });
  }

  // ---------- 今週のふり返り ----------
  function parseKey(k) { var a = k.split('-'); return Date.UTC(+a[0], +a[1] - 1, +a[2]); }
  function addDays(k, n) {
    var d = new Date(parseKey(k) + n * 86400000);
    return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
  }
  function sumDays(hist, keys) {
    var t = { days: 0, p: 0, ok: 0, h: 0, s: 0, ms: 0, sk: {} };
    keys.forEach(function (k) {
      var d = hist[k]; if (!d) return;
      if (d.p > 0) t.days++;
      t.p += d.p || 0; t.ok += d.ok || 0; t.h += d.h || 0; t.s += d.s || 0; t.ms += d.ms || 0;
      Object.keys(d.sk || {}).forEach(function (id) { var a = t.sk[id] = t.sk[id] || [0, 0]; a[0] += d.sk[id][0]; a[1] += d.sk[id][1]; });
    });
    t.rate = t.p ? t.ok / t.p : null;
    return t;
  }
  /** 今日をふくむ7日（今週）と、その前の7日（先週） */
  function weekSummary(hist, todayKey) {
    hist = hist || {};
    var cur = [], prev = [];
    for (var i = 6; i >= 0; i--) cur.push(addDays(todayKey, -i));
    for (var j = 13; j >= 7; j--) prev.push(addDays(todayKey, -j));
    var c = sumDays(hist, cur), p = sumDays(hist, prev), MIN = 5;
    var rateOf = function (a) { return a && a[0] >= MIN ? a[1] / a[0] : null; };
    var rows = SKILLS.map(function (s) { return { id: s.id, name: s.name, cur: rateOf(c.sk[s.id]), prev: rateOf(p.sk[s.id]), n: (c.sk[s.id] || [0])[0] }; })
      .filter(function (r) { return r.cur !== null; });
    var weak = rows.filter(function (r) { return r.cur >= WEAK_RATE; }).sort(function (a, b) { return b.cur - a.cur; });
    var moved = rows.filter(function (r) { return r.prev !== null; });
    var better = moved.filter(function (r) { return r.prev - r.cur >= WEAK_RATE; }).sort(function (a, b) { return (b.prev - b.cur) - (a.prev - a.cur); })[0] || null;
    var worse = moved.filter(function (r) { return r.cur - r.prev >= WEAK_RATE; }).sort(function (a, b) { return (b.cur - b.prev) - (a.cur - a.prev); })[0] || null;
    return {
      cur: c, prev: p, weak: weak, better: better, worse: worse,
      bars: cur.map(function (k) { return { key: k, p: (hist[k] && hist[k].p) || 0 }; })
    };
  }
  function pct(x) { return Math.round(x * 100) + '%'; }
  /** おうちの人への ひとこと */
  function adviceLines(w) {
    var out = [];
    if (!w.cur.p) { out.push('今週はまだ練習していません。「1日10問だけ」から声をかけてみてください。'); return out; }
    if (w.better) out.push('「' + w.better.name + '」のつまずきが 先週 ' + pct(w.better.prev) + ' → 今週 ' + pct(w.better.cur) + ' に減りました。ほめてあげてください。');
    if (w.worse) out.push('「' + w.worse.name + '」が 先週 ' + pct(w.worse.prev) + ' → 今週 ' + pct(w.worse.cur) + ' に増えています。ホームの「苦手練習」で集中して練習できます。');
    if (!w.better && !w.worse && w.weak.length) out.push('今週いちばんつまずいたのは「' + w.weak[0].name + '」（' + pct(w.weak[0].cur) + '）です。');
    if (w.prev.p && w.cur.rate !== null && w.prev.rate !== null) {
      var d = Math.round((w.cur.rate - w.prev.rate) * 100);
      if (d >= 5) out.push('ノーミスで解けた割合が先週より ' + d + ' ポイント上がりました。');
    }
    if (w.cur.days >= 5) out.push('今週は ' + w.cur.days + ' 日 練習しました。毎日の習慣になっています。');
    if (!out.length) out.push('つまずきは少なめです。この調子で続けられるように見守ってください。');
    return out;
  }

  // ---------- わり算の見当（2けたでわるとき） ----------
  /** わる数を何十とみたときの、だいたいの商。r < b なら 0 */
  function divGuess(r, b) {
    if (b < 10) return null;
    if (r < b) return { b10: 0, g: 0 };
    var b10 = Math.round(b / 10) * 10;
    return { b10: b10, g: Math.max(1, Math.min(9, Math.floor(r / b10))) };
  }

  // ---------- 記録の引っ越しコード ----------
  function b64e(str) {
    if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf8').toString('base64');
    return btoa(unescape(encodeURIComponent(str)));
  }
  function b64d(b) {
    if (typeof Buffer !== 'undefined') return Buffer.from(b, 'base64').toString('utf8');
    return decodeURIComponent(escape(atob(b)));
  }
  function hash(s) { var h = 0x811c9dc5; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return ('0000000' + h.toString(16)).slice(-8); }
  /** keys = {localStorage のキー: 値} → コード。tag はどのアプリの記録か（'knock' / 'battle'） */
  function packBackup(tag, keys, at) {
    var body = b64e(JSON.stringify({ app: tag, v: 1, at: at || '', keys: keys }));
    return 'HSN1.' + tag + '.' + body + '.' + hash(body);
  }
  /** コード → {ok:true, data} / {ok:false, err}。途中で切れた・ちがうアプリのコードははじく */
  function unpackBackup(tag, code) {
    var s = String(code || '').replace(/\s+/g, '');
    var m = /^HSN1\.([a-z]+)\.([A-Za-z0-9+/=]+)\.([0-9a-f]{8})$/.exec(s);
    if (!m) return { ok: false, err: 'コードの形がちがう（全部コピーできているか確かめてね）' };
    if (m[1] !== tag) return { ok: false, err: m[1] === 'battle' ? 'これは筆算バトルのコード。バトルのページで読みこんでね' : 'これは筆算ノックのコード。ノックのアプリで読みこんでね' };
    if (hash(m[2]) !== m[3]) return { ok: false, err: 'コードが途中で切れているか、まちがっている' };
    var o; try { o = JSON.parse(b64d(m[2])); } catch (e) { return { ok: false, err: 'コードが読めなかった' }; }
    if (!o || o.app !== tag || !o.keys || typeof o.keys !== 'object') return { ok: false, err: 'コードが読めなかった' };
    var keys = {};
    Object.keys(o.keys).forEach(function (k) { if (typeof o.keys[k] === 'string') keys[k] = o.keys[k]; });
    return { ok: true, data: { at: String(o.at || ''), keys: keys } };
  }

  return {
    SKILLS: SKILLS, skillName: skillName, skillOf: skillOf, recordStep: recordStep, recordProblem: recordProblem, recordSet: recordSet,
    weakList: weakList, makeWeakSet: makeWeakSet, addDays: addDays, weekSummary: weekSummary, adviceLines: adviceLines,
    divGuess: divGuess, packBackup: packBackup, unpackBackup: unpackBackup
  };
});
