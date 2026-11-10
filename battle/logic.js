/**
 * バトルのきまりごと（画面・通信に依存しない）。
 * ブラウザでは window.BattleLogic、Node では module.exports。core.js（HissanCore）を使う。
 *
 * ルール（2026-11-11 決定）
 *  - 3ラウンド × 1ラウンド3問。2人に同じ問題（同じ seed）
 *  - ラウンドの前にじゃんけん。負けた側はスタートが遅れる（たし算・ひき算・ミックス 3秒、かけ算・わり算 6秒）。あいこは同時
 *  - ミスは2秒止まる（解く時間に入るので、ここでは solve に含まれている）
 *  - ラウンドは「遅れ＋解いた時間」が短いほうの勝ち。1・2ラウンドは1点、最終ラウンドは2点
 *  - 点が同じなら合計タイムが短いほうの勝ち
 *  - 同じ相手に2勝以上勝ち越している側は毎ラウンド +2秒（3勝差以上は +4秒）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../core.js'));
  else root.BattleLogic = factory(root.HissanCore);
})(this, function (C) {
  'use strict';

  var OPS = ['add', 'sub', 'mix', 'mul', 'div'];
  var ROUNDS = 3, PER = 3;
  var POINTS = [1, 1, 2];
  var MISS_MS = 2000;
  var HANDS = ['g', 'c', 'p'];               // グー・チョキ・パー
  var HAND_NAME = { g: 'グー', c: 'チョキ', p: 'パー' };
  var HAND_ICON = { g: '✊', c: '✌️', p: '✋' };

  function jankenMs(op) { return op === 'mul' || op === 'div' ? 6000 : 3000; }

  function mulberry(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0; var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** cfg = {op, dec(0/1), lv(2/3), seed} を正しい範囲に直す */
  function cleanCfg(c) {
    c = c || {};
    return {
      op: OPS.indexOf(c.op) >= 0 ? c.op : 'add',
      dec: c.dec ? 1 : 0,
      lv: c.lv === 3 ? 3 : 2,
      seed: (Number(c.seed) >>> 0) || 1
    };
  }

  /** 9問を作る（本体アプリの makeSet と同じ手順）。round r の問題は set.slice(r*3, r*3+3) */
  function makeSet(cfg) {
    var c = cleanCfg(cfg), rng = mulberry(c.seed), set = [], prevKey = '';
    for (var i = 0; i < ROUNDS * PER; i++) {
      var op = c.op === 'mix' ? (rng() < 0.5 ? 'add' : 'sub') : c.op;
      var p, tries = 0;
      do {
        p = op === 'div' ? (c.dec ? C.generateDecimalDiv(c.lv, rng) : C.generateDivProblem(c.lv, rng))
          : c.dec ? C.generateDecimalProblem(op, c.lv, rng) : C.generateProblem(op, c.lv, rng);
        tries++;
      } while (tries < 20 && (p.a + '_' + p.b) === prevKey);
      prevKey = p.a + '_' + p.b; set.push(p);
    }
    return set;
  }
  function randomSeed() { return (Math.floor(Math.random() * 4294967295) + 1) >>> 0; }

  // ---------- じゃんけん ----------
  /** a から見た勝ち負け: 1=勝ち, -1=負け, 0=あいこ */
  function janken(a, b) {
    if (a === b) return 0;
    return (a === 'g' && b === 'c') || (a === 'c' && b === 'p') || (a === 'p' && b === 'g') ? 1 : -1;
  }

  // ---------- ハンデ ----------
  /** 勝ち越し数 lead（自分の勝ち − 負け）から、自分にかかるハンデ（ms） */
  function handicapMs(lead) { return lead >= 3 ? 4000 : lead >= 2 ? 2000 : 0; }
  /** 記録 rec から、相手 oppName との試合のハンデ {me, opp} */
  function handicapFor(rec, oppName) {
    var r = rec && rec.rivals && rec.rivals[rivalKey(oppName)];
    var lead = r ? r.w - r.l : 0;
    return { me: handicapMs(lead), opp: handicapMs(-lead) };
  }

  // ---------- 試合の計算 ----------
  /**
   * A, B = {h:[手×3], sp:[[累計ms×3]×3]}（sp[r][2] がそのラウンドを解き終えた時間）
   * opt = {op, hcA, hcB}
   * 返り値: rounds[{ha,hb,j(Aから見たじゃんけん), delayA, delayB, timeA, timeB, win('A'|'B'|''), pts}], ptsA, ptsB, totalA, totalB, win
   */
  function roundResult(ha, hb, solveA, solveB, r, opt) {
    var j = janken(ha, hb), jm = jankenMs(opt.op);
    var dA = (j < 0 ? jm : 0) + (opt.hcA || 0), dB = (j > 0 ? jm : 0) + (opt.hcB || 0);
    var tA = dA + solveA, tB = dB + solveB;
    var win = tA < tB ? 'A' : tB < tA ? 'B' : '';
    return { ha: ha, hb: hb, j: j, delayA: dA, delayB: dB, timeA: tA, timeB: tB, win: win, pts: win ? POINTS[r] : 0 };
  }
  function match(A, B, opt) {
    var rounds = [], pa = 0, pb = 0, ta = 0, tb = 0;
    for (var r = 0; r < ROUNDS; r++) {
      var x = roundResult(A.h[r], B.h[r], solveOf(A, r), solveOf(B, r), r, opt);
      rounds.push(x);
      if (x.win === 'A') pa += x.pts; else if (x.win === 'B') pb += x.pts;
      ta += x.timeA; tb += x.timeB;
    }
    var win = pa > pb ? 'A' : pb > pa ? 'B' : ta < tb ? 'A' : tb < ta ? 'B' : '';
    return { rounds: rounds, ptsA: pa, ptsB: pb, totalA: ta, totalB: tb, win: win, byTime: pa === pb };
  }
  function solveOf(P, r) { return P.sp[r][PER - 1]; }

  /** ゴースト: そのラウンドの経過 t(ms) で何問進んでいるか（0〜3）。delay の間は 0 */
  function ghostProgress(spr, delay, t) {
    t -= delay; if (t <= 0) return 0;
    var prev = 0;
    for (var i = 0; i < spr.length; i++) {
      if (t < spr[i]) return i + (t - prev) / (spr[i] - prev);
      prev = spr[i];
    }
    return spr.length;
  }

  // ---------- コード（URL の # に入れる文字列） ----------
  function b64encode(str) {
    if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf8').toString('base64');
    return btoa(unescape(encodeURIComponent(str)));
  }
  function b64decode(b) {
    if (typeof Buffer !== 'undefined') return Buffer.from(b, 'base64').toString('utf8');
    return decodeURIComponent(escape(atob(b)));
  }
  function encode(obj) { return b64encode(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function decode(s) {
    try {
      var b = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      return JSON.parse(b64decode(b));
    } catch (e) { return null; }
  }

  function cleanName(s) { return String(s || '').replace(/[\u0000-\u001f<>&"']/g, '').trim().slice(0, 8) || 'ななし'; }
  function cleanPlayer(p) {
    if (!p || !Array.isArray(p.h) || !Array.isArray(p.sp) || p.h.length !== ROUNDS || p.sp.length !== ROUNDS) return null;
    var h = [], sp = [];
    for (var r = 0; r < ROUNDS; r++) {
      if (HANDS.indexOf(p.h[r]) < 0) return null; h.push(p.h[r]);
      var row = p.sp[r]; if (!Array.isArray(row) || row.length !== PER) return null;
      var out = [], prev = 0;
      for (var i = 0; i < PER; i++) { var v = Math.round(Number(row[i])); if (!(v > prev) || v > 1800000) return null; out.push(v); prev = v; }
      sp.push(out);
    }
    return { nm: cleanName(p.nm), m: String(p.m || 'chigusa').replace(/[^a-z]/g, '').slice(0, 12), h: h, sp: sp, miss: Math.max(0, Math.min(999, p.miss | 0)) };
  }
  /** 挑戦状: 出した人(a)の手と記録。ハンデは受けた人が自分の記録から決める */
  function makeChallenge(cfg, a, id) { return encode({ v: 2, k: 'c', id: id, c: cleanCfg(cfg), a: a }); }
  /** 返事: 挑戦状に受けた人(b)の手と記録、使ったハンデ（hcA=出した人, hcB=受けた人）を足す */
  function makeReply(ch, b, hc) { return encode({ v: 2, k: 'r', id: ch.id, c: ch.c, a: ch.a, b: b, hc: [hc.a | 0, hc.b | 0] }); }
  function readCode(s) {
    var o = decode(s);
    if (!o || o.v !== 2 || (o.k !== 'c' && o.k !== 'r')) return null;
    var a = cleanPlayer(o.a); if (!a) return null;
    var out = { k: o.k, id: String(o.id || '').replace(/[^\w]/g, '').slice(0, 16), c: cleanCfg(o.c), a: a };
    if (o.k === 'r') {
      out.b = cleanPlayer(o.b); if (!out.b) return null;
      var hc = Array.isArray(o.hc) ? o.hc : [0, 0];
      out.hc = { a: Math.max(0, Math.min(4000, hc[0] | 0)), b: Math.max(0, Math.min(4000, hc[1] | 0)) };
    }
    return out;
  }

  // ---------- 記録 ----------
  function rivalKey(nm) { return cleanName(nm).toLowerCase(); }
  /** rec.rivals を更新して、その相手の記録を返す。st: +なら連勝中、-なら連敗中 */
  function addResult(rec, oppName, oppM, res) {
    rec.rivals = rec.rivals || {};
    var k = rivalKey(oppName), r = rec.rivals[k] || { nm: cleanName(oppName), m: oppM, w: 0, l: 0, d: 0, st: 0, n: 0 };
    r.nm = cleanName(oppName); r.m = oppM || r.m; r.n++;
    if (res === 'win') { r.w++; r.st = r.st > 0 ? r.st + 1 : 1; }
    else if (res === 'lose') { r.l++; r.st = r.st < 0 ? r.st - 1 : -1; }
    else { r.d++; r.st = 0; }
    r.last = Date.now();
    rec.rivals[k] = r;
    return r;
  }

  /** 試合後のひとこと。m は match() の結果、side は自分が 'A' か 'B' か、rival は addResult 後の記録 */
  function verdict(m, side, rival) {
    var me = side, res = m.win === me ? 'win' : m.win ? 'lose' : 'draw', lines = [];
    var myT = side === 'A' ? m.totalA : m.totalB, opT = side === 'A' ? m.totalB : m.totalA;
    var diff = ((Math.abs(myT - opT)) / 1000).toFixed(1);
    if (res === 'win') {
      if (m.byTime) lines.push('点は同じ！ タイム ' + diff + '秒差で勝ち！');
      var last = m.rounds[ROUNDS - 1]; if (last.win === me && last.pts === 2) lines.push('最終ラウンドを取った！');
      if (rival && rival.st >= 2) lines.push(rival.st + '連勝中！');
    } else if (res === 'lose') {
      if (m.byTime) lines.push('点は同じ…タイム ' + diff + '秒差！ おしい！！');
      m.rounds.forEach(function (x, r) {
        var mine = side === 'A' ? x.timeA : x.timeB, his = side === 'A' ? x.timeB : x.timeA;
        if (x.win && x.win !== me && mine - his < 2000) lines.push((r + 1) + 'ラウンド目は あと ' + ((mine - his) / 1000).toFixed(1) + '秒だった！');
      });
      if (rival && rival.l - rival.w === 1) lines.push('次に勝てば 五分にもどる！');
      else if (rival && rival.w === rival.l) lines.push('次に勝てば 勝ち越し！');
    } else lines.push('まさかの完全引き分け！');
    return { res: res, lines: lines };
  }

  return {
    OPS: OPS, ROUNDS: ROUNDS, PER: PER, POINTS: POINTS, MISS_MS: MISS_MS, HANDS: HANDS, HAND_NAME: HAND_NAME, HAND_ICON: HAND_ICON,
    jankenMs: jankenMs, mulberry: mulberry, cleanCfg: cleanCfg, makeSet: makeSet, randomSeed: randomSeed,
    janken: janken, handicapMs: handicapMs, handicapFor: handicapFor, roundResult: roundResult, match: match, ghostProgress: ghostProgress,
    encode: encode, decode: decode, cleanName: cleanName, cleanPlayer: cleanPlayer,
    makeChallenge: makeChallenge, makeReply: makeReply, readCode: readCode,
    rivalKey: rivalKey, addResult: addResult, verdict: verdict
  };
});
