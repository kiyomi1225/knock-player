/*
 * 筆算トレーナー — 手順エンジン（UI非依存）
 * ブラウザでは window.HissanCore、Node では module.exports として使う。
 *
 * ステップの種類（col は 0 が一の位 = 右端）
 *   {type:'carry',  col:j, from:j-1, sum}       たし算: 列 j の上に「くり上がりの 1」を置く
 *   {type:'borrow', col:j, to:j-1, before, after, toBefore, toAfter}
 *                                              ひき算: 列 j の数字から 1 借りて、列 j-1 に 10 わたす
 *   {type:'digit',  col:i, answer, top, bot, carryIn, sum, row}
 *                                              列 i に答えの数字を書く（row はかけ算の部分積の行、省略時は答えの行）
 *   {type:'mul',    row:j, col:i+j, ai, bj, carryIn, prod, answer, carryOut}
 *                                              かけ算: a の i 桁目 × b の j 桁目 (+くり上がり) の一の位を書く
 *   {type:'mulcarry', row:j, col, answer}      かけ算: 行の最後に残ったくり上がりをそのまま書く
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HissanCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function digitsOf(n) {
    return String(n).split('').reverse().map(Number); // [一, 十, 百, ...]
  }
  function numDigits(n) {
    return n === 0 ? 1 : String(n).length;
  }

  function buildSteps(p) {
    if (p.op === 'div') return divPlan(p).steps;
    if (p.da !== undefined || p.db !== undefined) return buildDecimalSteps(p);
    if (p.op === 'add') return buildAddSteps(p.a, p.b);
    if (p.op === 'sub') return buildSubSteps(p.a, p.b);
    if (p.op === 'mul') return buildMulSteps(p.a, p.b);
    throw new Error('unknown op: ' + p.op);
  }

  /**
   * 小数の問題: a, b は小数点を取った整数、da, db は小数点以下の桁数。
   *   add/sub: 小数点をそろえる（桁数の少ない方を 10 倍して合わせる）→ 整数の手順 → 最後に小数点を打つ {type:'point', col:dr}
   *   mul:     整数として計算 → 小数点以下 da+db 桁になるよう 0 を補う → 小数点を打つ
   * どの位も「一の位」(col = dr) までは必ず数字を書く（0.7 の 0 など）。
   */
  function decimalInfo(p) {
    var da = p.da || 0, db = p.db || 0;
    if (p.op === 'mul') return { dr: da + db, a: p.a, b: p.b, da: da, db: db };
    var dr = Math.max(da, db);
    return { dr: dr, a: p.a * Math.pow(10, dr - da), b: p.b * Math.pow(10, dr - db), da: da, db: db };
  }
  function buildDecimalSteps(p) {
    var d = decimalInfo(p), steps;
    if (p.op === 'add') steps = buildAddSteps(d.a, d.b, d.dr + 1);
    else if (p.op === 'sub') steps = buildSubSteps(d.a, d.b, d.dr + 1);
    else if (p.op === 'mul') steps = buildMulSteps(d.a, d.b, d.dr + 1);
    else throw new Error('unknown op: ' + p.op);
    steps.push({ type: 'point', col: d.dr });
    return steps;
  }

  function buildAddSteps(a, b, minDigits) {
    var da = digitsOf(a), db = digitsOf(b);
    var cols = Math.max(da.length, db.length, minDigits || 0);
    var steps = [], carry = 0;
    for (var i = 0; i < cols; i++) {
      var top = da[i] || 0, bot = db[i] || 0, carryIn = carry;
      var sum = top + bot + carryIn;
      if (sum >= 10) steps.push({ type: 'carry', col: i + 1, from: i, sum: sum, value: 1 });
      steps.push({ type: 'digit', col: i, answer: sum % 10, top: top, bot: bot, carryIn: carryIn, sum: sum });
      carry = sum >= 10 ? 1 : 0;
    }
    if (carry) steps.push({ type: 'digit', col: cols, answer: 1, top: 0, bot: 0, carryIn: 1, sum: 1 });
    return steps;
  }

  function buildSubSteps(a, b, minDigits) {
    if (a < b) throw new Error('a must be >= b');
    var da = digitsOf(a), db = digitsOf(b);
    var cols = Math.max(da.length, minDigits || 0);
    var eff = da.slice(); while (eff.length < cols) eff.push(0);
    var resultDigits = Math.max(numDigits(a - b), minDigits || 0);
    var steps = [];

    function borrowFrom(j) {
      if (j >= cols) throw new Error('cannot borrow beyond top column');
      if (eff[j] === 0) borrowFrom(j + 1); // 0 からは借りられないので、さらに上の位から
      steps.push({
        type: 'borrow', col: j, to: j - 1,
        before: eff[j], after: eff[j] - 1,
        toBefore: eff[j - 1], toAfter: eff[j - 1] + 10
      });
      eff[j] -= 1;
      eff[j - 1] += 10;
    }

    for (var i = 0; i < cols; i++) {
      var bot = db[i] || 0;
      if (eff[i] < bot) borrowFrom(i + 1);
      var diff = eff[i] - bot;
      if (i < resultDigits) {
        steps.push({ type: 'digit', col: i, answer: diff, top: eff[i], bot: bot, carryIn: 0, sum: diff });
      }
    }
    return steps;
  }

  function buildMulSteps(a, b, minDigits) {
    var da = digitsOf(a), db = digitsOf(b);
    minDigits = minDigits || 0;
    var steps = [];
    var partials = [];
    for (var j = 0; j < db.length; j++) {
      var bj = db[j], carry = 0, partial = 0;
      for (var i = 0; i < da.length; i++) {
        var prod = da[i] * bj + carry;
        steps.push({
          type: 'mul', row: j, col: i + j, ai: da[i], bj: bj, carryIn: carry,
          prod: prod, answer: prod % 10, carryOut: Math.floor(prod / 10)
        });
        carry = Math.floor(prod / 10);
      }
      if (carry) steps.push({ type: 'mulcarry', row: j, col: da.length + j, answer: carry });
      partial = a * bj * Math.pow(10, j);
      partials.push(partial);
    }
    if (db.length > 1) {
      // 部分積を足し合わせる（たし算の手順をそのまま使う。先頭行は 0 を書かない）
      var total = 0, cols = Math.max(numDigits(a * b), minDigits);
      var pd = partials.map(digitsOf);
      var carry2 = 0;
      for (var c = 0; c < cols; c++) {
        var sum = carry2;
        for (var r = 0; r < pd.length; r++) sum += pd[r][c] || 0;
        if (sum >= 10) steps.push({ type: 'carry', col: c + 1, from: c, sum: sum, value: Math.floor(sum / 10) });
        steps.push({ type: 'digit', col: c, answer: sum % 10, top: pd[0][c] || 0, bot: pd[1][c] || 0, carryIn: carry2, sum: sum, parts: pd.map(function (d) { return d[c] || 0; }) });
        carry2 = Math.floor(sum / 10);
      }
      total = a * b;
      if (carry2) throw new Error('internal: unexpected final carry for ' + total);
    } else {
      // 1けたをかけたとき: 小数で必要な桁まで 0 を補う（0.3 × 2 = 0.6 の 0）
      for (var z = numDigits(a * b); z < minDigits; z++) steps.push({ type: 'digit', col: z, answer: 0, top: 0, bot: 0, carryIn: 0, sum: 0, zero: true });
    }
    return steps;
  }

  /**
   * わり算の筆算（たてる→かける→ひく→おろす）。
   * 小数のときは、わる数が整数になるまで両方の小数点を右へ動かしてから整数と同じ手順。
   * 戻り値: { steps, rows, n, D, ones, bS, daQ, shift, remainder, quotient, leftCols, oldA, newA, oldB, newB, bDigits }
   *   steps: {type:'quot', col, answer, r, b}            商をたてる（col は 0 が右端）
   *          {type:'prod', row, col, answer, q, b, p}     かけた数を書く（右から）
   *          {type:'diff', row, col, answer, r, p, diff}  引いた数を書く（右から）
   *          {type:'down', row, col, answer}              次の桁をおろす
   *          {type:'point', col}                          商の小数点（一の位の数字を書いた直後）
   *   rows:  {type:'prod'|'diff', col, width}  上から順。prod の下には横線
   */
  function divPlan(p) {
    var dec = p.da !== undefined || p.db !== undefined;
    var da = p.da || 0, db = p.db || 0;
    var shift = db;
    var aS = p.a * Math.pow(10, Math.max(0, db - da));
    var daQ = Math.max(0, da - db);
    var bS = p.b;
    var D = String(aS).split('').map(Number);
    while (D.length < daQ + 1) D.unshift(0);
    var n = D.length, ones = daQ;
    var steps = [], rows = [], r = 0, started = false, curRow = -1;
    for (var i = 0; i < n; i++) {
      var col = n - 1 - i;
      if (started && curRow >= 0) steps.push({ type: 'down', row: curRow, col: col, answer: D[i] });
      r = r * 10 + D[i];
      if (!started && r < bS && col > ones) continue;
      started = true;
      var q = Math.floor(r / bS);
      steps.push({ type: 'quot', col: col, answer: q, r: r, b: bS });
      if (dec && daQ > 0 && col === ones) steps.push({ type: 'point', col: ones });
      if (q > 0) {
        var pr = q * bS, pd = digitsOf(pr);
        var prodRow = rows.length; rows.push({ type: 'prod', col: col, width: Math.max(pd.length, numDigits(r)) });
        for (var k = 0; k < pd.length; k++) steps.push({ type: 'prod', row: prodRow, col: col + k, answer: pd[k], q: q, b: bS, p: pr });
        var diff = r - pr, dd = digitsOf(diff);
        var diffRow = rows.length; rows.push({ type: 'diff', col: col, width: dd.length });
        for (var k2 = 0; k2 < dd.length; k2++) steps.push({ type: 'diff', row: diffRow, col: col + k2, answer: dd[k2], r: r, p: pr, diff: diff });
        r = diff; curRow = diffRow;
      }
    }
    var bDigits = digitsOf(bS);
    while (dec && bDigits.length < db + 1) bDigits.push(0);   // 0.8 → 「0.8」と表示するための先頭の 0
    return {
      steps: steps, rows: rows, n: n, D: D, ones: ones, bS: bS, daQ: daQ, shift: shift, dec: dec,
      remainder: r, quotient: Math.floor(aS / bS), leftCols: bDigits.length + 1, bDigits: bDigits,
      padA: Math.max(0, db - da),                 // わられる数に足した 0 の数（右端から）
      oldA: da > 0 ? Math.max(da, db) : -1,       // もとの小数点の位置（col）
      newA: dec && (shift > 0 || daQ > 0) ? daQ : -1,
      oldB: db > 0 ? db : -1,
      newB: shift > 0 ? 0 : -1
    };
  }

  /**
   * わり算の問題生成（整数）
   *  1: 2けた ÷ 1けた（あまりあり・なし）  2: 3けた ÷ 1けた（商に 0 が立つことも）  3: 3けた ÷ 2けた
   */
  function generateDivProblem(level, rng) {
    rng = rng || Math.random;
    for (var t = 0; t < 1000; t++) {
      var a, b;
      if (level === 1) { b = rint(rng, 2, 9); a = rint(rng, 10, 99); }
      else if (level === 2) { b = rint(rng, 2, 9); a = rint(rng, 100, 999); }
      else { b = rint(rng, 11, 99); a = rint(rng, 100, 999); if (a < b * 2) continue; }
      if (a < b) continue;
      return { op: 'div', a: a, b: b };
    }
    throw new Error('generateDivProblem: no problem found');
  }
  /**
   * わり算の問題生成（小数・わり切れる）
   *  1: 小数第1位 ÷ 1けた（7.2 ÷ 3）  2: 小数第2位 ÷ 1けた（1.25 ÷ 5、0.36 ÷ 4）  3: 小数 ÷ 小数第1位（7.2 ÷ 1.8、2.52 ÷ 0.7）
   *  わり進み（0 を足して割る）が必要な問題は出さない。
   */
  function generateDecimalDiv(level, rng) {
    rng = rng || Math.random;
    for (var t = 0; t < 1000; t++) {
      var a, b, da, db, q;
      if (level === 1) { b = rint(rng, 2, 9); q = decNum(rng, 9, 1, rng() < 0.25); a = q * b; da = 1; db = 0; }
      else if (level === 2) { b = rint(rng, 2, 9); q = decNum(rng, 9, 2, rng() < 0.35); a = q * b; da = 2; db = 0; }
      else { b = decNum(rng, 9, 1, rng() < 0.3); var dq = rint(rng, 0, 1); q = dq ? decNum(rng, 9, 1, rng() < 0.3) : rint(rng, 2, 9); a = q * b; da = dq + 1; db = 1; }
      if (a % 10 === 0) continue;                       // 末尾 0 → わり進みが必要になるので除外
      if (numDigits(a) > 4) continue;
      return { op: 'div', a: a, b: b, da: da, db: db };
    }
    throw new Error('generateDecimalDiv: no problem found');
  }

  /** 列の数（答えの欄を含む）。たし算はくり上がり用に 1 列多い。 */
  function columnCount(p) {
    if (p.op === 'div') return divPlan(p).n;
    if (p.da !== undefined || p.db !== undefined) {
      var d = decimalInfo(p);
      if (p.op === 'mul') return Math.max(numDigits(d.a) + numDigits(d.b), d.dr + 1);
      var m = Math.max(numDigits(d.a), numDigits(d.b), d.dr + 1);
      return p.op === 'add' ? m + 1 : m;
    }
    if (p.op === 'mul') return numDigits(p.a) + numDigits(p.b);
    var n = Math.max(numDigits(p.a), numDigits(p.b));
    return p.op === 'add' ? n + 1 : n;
  }

  function formatSteps(steps) {
    return steps.map(function (s) {
      if (s.type === 'carry') return 'C' + s.col + (s.value > 1 ? '=' + s.value : '');
      if (s.type === 'borrow') return 'B' + s.col;
      if (s.type === 'mul') return 'M' + s.row + '.' + s.col + '=' + s.answer;
      if (s.type === 'mulcarry') return 'K' + s.row + '.' + s.col + '=' + s.answer;
      if (s.type === 'point') return 'P' + s.col;
      if (s.type === 'quot') return 'Q' + s.col + '=' + s.answer;
      if (s.type === 'prod') return 'X' + s.row + '.' + s.col + '=' + s.answer;
      if (s.type === 'diff') return 'S' + s.row + '.' + s.col + '=' + s.answer;
      if (s.type === 'down') return 'W' + s.row + '.' + s.col + '=' + s.answer;
      return 'D' + s.col + '=' + s.answer;
    }).join(' ');
  }

  // ---------- 問題生成 ----------
  function rint(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); }

  /**
   * op: 'add' | 'sub' | 'mul',  level: 1 | 2 | 3
   *  add1: 2けた+2けた, くり上がりなし
   *  add2: 2けた+2けた, 一の位でくり上がり 1回, 答えは 2けた
   *  add3: 3けた+3けた, くり上がり 1回以上
   *  sub1: 2けた-2けた, くり下がりなし, 答えは 2けた
   *  sub2: 2けた-2けた, 一の位でくり下がり 1回, 答えは 2けた
   *  sub3: 3けた-3けた, くり下がり 1回以上（0 をまたぐ連続も出る）
   *  mul1: 2けた×1けた
   *  mul2: 2けた×2けた
   *  mul3: 3けた×2けた
   */
  function generateProblem(op, level, rng) {
    rng = rng || Math.random;
    for (var tries = 0; tries < 1000; tries++) {
      var a, b, steps;
      if (op === 'add') {
        if (level === 1) {
          var o1 = rint(rng, 0, 9), o2 = rint(rng, 0, 9 - o1);
          var t1 = rint(rng, 1, 8), t2 = rint(rng, 1, 9 - t1);
          a = t1 * 10 + o1; b = t2 * 10 + o2;
        } else if (level === 2) {
          var p1 = rint(rng, 1, 9), p2 = rint(rng, 10 - p1, 9);
          var q1 = rint(rng, 1, 7), q2 = rint(rng, 1, 8 - q1);
          a = q1 * 10 + p1; b = q2 * 10 + p2;
        } else {
          a = rint(rng, 100, 999); b = rint(rng, 100, 999);
          steps = buildAddSteps(a, b);
          if (!steps.some(function (s) { return s.type === 'carry'; })) continue;
        }
        if (rng() < 0.5) { var t = a; a = b; b = t; }
      } else if (op === 'sub') {
        if (level === 1) {
          var bo = rint(rng, 0, 9), ao = rint(rng, bo, 9);
          var bt = rint(rng, 1, 8), at = rint(rng, bt + 1, 9);
          a = at * 10 + ao; b = bt * 10 + bo;
        } else if (level === 2) {
          var bo2 = rint(rng, 1, 9), ao2 = rint(rng, 0, bo2 - 1);
          var bt2 = rint(rng, 1, 7), at2 = rint(rng, bt2 + 2, 9);
          a = at2 * 10 + ao2; b = bt2 * 10 + bo2;
        } else {
          a = rint(rng, 100, 999); b = rint(rng, 100, 999);
          if (rng() < 0.25) a = a - (Math.floor(a / 10) % 10) * 10; // 十の位を 0 にして連続くり下がりを出す
          if (a <= b) continue;
          if (a - b < 10) continue;
          steps = buildSubSteps(a, b);
          if (!steps.some(function (s) { return s.type === 'borrow'; })) continue;
        }
      } else {
        if (level === 1) { a = rint(rng, 12, 99); b = rint(rng, 2, 9); }
        else if (level === 2) { a = rint(rng, 12, 99); b = rint(rng, 12, 99); }
        else { a = rint(rng, 102, 999); b = rint(rng, 12, 99); }
        if (b % 10 === 0 || a % 10 === 0) continue; // 一の位が 0 の数は別の型なので今は出さない
      }
      return { op: op, a: a, b: b };
    }
    throw new Error('generateProblem: no problem found');
  }

  /**
   * 小数の問題生成。戻り値 {op, a, b, da, db}（a, b は小数点を取った整数）
   *  add/sub 1: 小数第1位どうし（2.3 + 4.5）
   *  add/sub 2: 小数第1位と第2位が混ざる＝位をそろえる練習（3.25 + 1.8）
   *  add/sub 3: 整数や 0 をふくむ、第2位まで（5 − 1.37、4.03 − 1.8、12.5 + 7.85）
   *  mul 1: 小数 × 整数（2.3 × 4）
   *  mul 2: 小数第1位 × 小数第1位（2.3 × 1.4、0.3 × 0.2）
   *  mul 3: 第2位まで × 第1〜2位（1.25 × 3.6）
   */
  function decNum(rng, intMax, d, allowZeroInt) {
    for (var k = 0; k < 100; k++) {
      var ip = rint(rng, allowZeroInt ? 0 : 1, intMax);
      var frac = d > 0 ? rint(rng, 1, Math.pow(10, d) - 1) : 0;
      if (d > 0 && frac % 10 === 0) continue;         // 末尾 0（2.30）は出さない
      var v = ip * Math.pow(10, d) + frac;
      if (v === 0) continue;
      return v;
    }
    return 1;
  }
  function generateDecimalProblem(op, level, rng) {
    rng = rng || Math.random;
    for (var tries = 0; tries < 1000; tries++) {
      var a, b, da, db;
      if (op === 'add' || op === 'sub') {
        if (level === 1) { da = db = 1; a = decNum(rng, 9, 1); b = decNum(rng, 9, 1); }
        else if (level === 2) { da = rint(rng, 1, 2); db = 3 - da; a = decNum(rng, 9, da); b = decNum(rng, 9, db); }
        else { da = rint(rng, 0, 2); db = rint(rng, 0, 2); if (da < 2 && db < 2) continue; a = decNum(rng, 19, da, true); b = decNum(rng, 19, db, true); }
        var va = a / Math.pow(10, da), vb = b / Math.pow(10, db);
        if (op === 'sub' && va <= vb) { var t = a; a = b; b = t; var td = da; da = db; db = td; va = a / Math.pow(10, da); vb = b / Math.pow(10, db); if (va <= vb) continue; }
        if (op === 'sub' && level >= 2 && Math.abs(va - vb) < 0.1) continue;
      } else {
        if (level === 1) { da = 1; db = 0; a = decNum(rng, 9, 1); b = rint(rng, 2, 9); }
        else if (level === 2) { da = 1; db = 1; a = decNum(rng, 9, 1, rng() < 0.3); b = decNum(rng, 9, 1, rng() < 0.3); }
        else { da = rint(rng, 1, 2); db = 3 - da; if (rng() < 0.3) db = 2; a = decNum(rng, 9, da, rng() < 0.2); b = decNum(rng, db === 1 ? 9 : 0, db, db === 2); if (numDigits(b) !== 2) continue; }
      }
      return { op: op, a: a, b: b, da: da, db: db };
    }
    throw new Error('generateDecimalProblem: no problem found');
  }

  /** 数値の表示: fmt(325, 2) → "3.25" */
  function fmt(n, d) {
    d = d || 0;
    if (!d) return String(n);
    var str = String(n); while (str.length < d + 1) str = '0' + str;
    return str.slice(0, str.length - d) + '.' + str.slice(str.length - d);
  }

  return {
    buildSteps: buildSteps,
    divPlan: divPlan,
    generateDivProblem: generateDivProblem,
    generateDecimalDiv: generateDecimalDiv,
    generateDecimalProblem: generateDecimalProblem,
    decimalInfo: decimalInfo,
    fmt: fmt,
    generateProblem: generateProblem,
    columnCount: columnCount,
    formatSteps: formatSteps,
    digitsOf: digitsOf,
    numDigits: numDigits
  };
});
