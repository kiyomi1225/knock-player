/**
 * リアルタイム対戦の中継。無料の公開 MQTT サーバー（WebSocket）を2つ同時に使い、
 * 同じメッセージを両方に送る。受け取る側は送り主ID＋通し番号で重複を捨てる。
 * サーバーを自分で用意しなくていい代わりに、送る中身は「名前・進み具合・タイム」だけにする。
 *   var r = BattleNet.join('1234', {onMsg:fn(msg), onStatus:fn(nConnected)}); r.send({t:'hello'}); r.close();
 */
(function (root) {
  'use strict';
  var BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
  var PREFIX = 'knock-battle-v1/';

  function utf8(s) { return new TextEncoder().encode(s); }
  function str(s) { var b = utf8(s), o = new Uint8Array(b.length + 2); o[0] = b.length >> 8; o[1] = b.length & 255; o.set(b, 2); return o; }
  function cat(parts) { var n = 0; parts.forEach(function (p) { n += p.length; }); var o = new Uint8Array(n), i = 0; parts.forEach(function (p) { o.set(p, i); i += p.length; }); return o; }
  function packet(type, body) {
    var len = [], x = body.length;
    do { var d = x % 128; x = Math.floor(x / 128); if (x > 0) d |= 128; len.push(d); } while (x > 0);
    return cat([new Uint8Array([type].concat(len)), body]);
  }
  function connectPkt(id) { return packet(0x10, cat([str('MQTT'), new Uint8Array([4, 2, 0, 30]), str(id)])); }
  function subPkt(topic) { return packet(0x82, cat([new Uint8Array([0, 1]), str(topic), new Uint8Array([0])])); }
  function pubPkt(topic, payload) { return packet(0x30, cat([str(topic), utf8(payload)])); }

  function Link(url, topic, onPayload, onState) {
    var ws = null, buf = new Uint8Array(0), ready = false, closed = false, ping = null, retry = 0;
    function open() {
      if (closed) return;
      try { ws = new WebSocket(url, ['mqtt']); } catch (e) { later(); return; }
      ws.binaryType = 'arraybuffer';
      ws.onopen = function () { ws.send(connectPkt('kb' + Math.random().toString(36).slice(2, 12))); };
      ws.onmessage = function (ev) { buf = cat([buf, new Uint8Array(ev.data)]); parse(); };
      ws.onclose = function () { set(false); clearInterval(ping); later(); };
      ws.onerror = function () { try { ws.close(); } catch (e) {} };
    }
    function later() { if (closed) return; retry = Math.min(retry + 1, 5); setTimeout(open, 800 * retry); }
    function set(v) { if (ready !== v) { ready = v; onState(); } }
    function parse() {
      for (;;) {
        if (buf.length < 2) return;
        var mul = 1, len = 0, i = 1, b;
        do { if (i >= buf.length) return; b = buf[i++]; len += (b & 127) * mul; mul *= 128; } while (b & 128);
        if (buf.length < i + len) return;
        var type = buf[0], body = buf.subarray(i, i + len);
        buf = buf.slice(i + len);
        if ((type & 0xf0) === 0x20) { ws.send(subPkt(topic)); }
        else if ((type & 0xf0) === 0x90) { retry = 0; set(true); clearInterval(ping); ping = setInterval(function () { try { ws.send(new Uint8Array([0xc0, 0])); } catch (e) {} }, 20000); }
        else if ((type & 0xf0) === 0x30) {
          var tl = (body[0] << 8) | body[1], off = 2 + tl + (((type >> 1) & 3) ? 2 : 0);
          try { onPayload(new TextDecoder().decode(body.subarray(off))); } catch (e) {}
        }
      }
    }
    open();
    return {
      send: function (s) { if (ready) try { ws.send(pubPkt(topic, s)); } catch (e) {} },
      ready: function () { return ready; },
      close: function () { closed = true; clearInterval(ping); try { ws.close(); } catch (e) {} }
    };
  }

  function join(room, h) {
    var me = Math.random().toString(36).slice(2, 10), seq = 0, seen = {}, links;
    function onPayload(s) {
      var m; try { m = JSON.parse(s); } catch (e) { return; }
      if (!m || m.f === me || typeof m.f !== 'string') return;
      var k = m.f + ':' + m.q; if (seen[k]) return; seen[k] = 1;
      h.onMsg && h.onMsg(m);
    }
    function state() { h.onStatus && h.onStatus(links.filter(function (l) { return l.ready(); }).length); }
    links = (h.brokers || BROKERS).map(function (u) { return Link(u, PREFIX + room, onPayload, state); });
    return {
      id: me,
      send: function (m) { m.f = me; m.q = ++seq; var s = JSON.stringify(m); links.forEach(function (l) { l.send(s); }); },
      connected: function () { return links.some(function (l) { return l.ready(); }); },
      close: function () { links.forEach(function (l) { l.close(); }); }
    };
  }

  root.BattleNet = { join: join, BROKERS: BROKERS };
})(this);
