// ASCENT relay: serves the game files and relays player state between clients in password-protected rooms.
// The relay never simulates anything; it only authenticates rooms and forwards messages.
//   node server.js [port]        (PORT env also works)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';

const root = dirname(fileURLToPath(import.meta.url));
const port = +(process.env.PORT || process.argv[2] || 8787);
const MAX_PER_ROOM = 16, MAX_ROOMS = 200;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const ok = p === '/index.html' || p === '/style.css' || p.startsWith('/src/');
  const file = normalize(join(root, p));
  if (!ok || !file.startsWith(root + sep)) { res.writeHead(404).end('Not found'); return; }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404).end('Not found'); }
});

const wss = new WebSocketServer({ server, maxPayload: 4096 });
const rooms = new Map();           // name -> { salt, hash, clients: Map(id -> ws) }
const failures = new Map();        // ip -> { n, until }
let nextId = 1;

const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const hashPass = (pass, salt) => scryptSync(pass, salt, 32);
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };

wss.on('connection', (ws, req) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
  ws.isAlive = true; ws.on('pong', () => (ws.isAlive = true));
  let room = null, me = null, tokens = 60, last = Date.now();

  ws.on('message', (raw) => {
    const now = Date.now(); tokens = Math.min(60, tokens + (now - last) / 1000 * 40); last = now;
    if (--tokens < 0) return;           // flood protection
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (!me) {
      if (m.t !== 'join') return;
      const f = failures.get(ip);
      if (f && f.until > now) return send(ws, { t: 'err', msg: 'Too many wrong passwords. Try again in a minute.' }), ws.close();
      const name = clean(m.room, 24).toLowerCase(), pass = String(m.pass ?? '').slice(0, 64);
      if (!name || pass.length < 3) return send(ws, { t: 'err', msg: 'Room name and a password (3+ chars) are required.' }), ws.close();
      let r = rooms.get(name), created = false;
      if (!r) {
        if (rooms.size >= MAX_ROOMS) return send(ws, { t: 'err', msg: 'Relay is full.' }), ws.close();
        const salt = randomBytes(16); r = { salt, hash: hashPass(pass, salt), clients: new Map() }; rooms.set(name, r); created = true;
      } else {
        const h = hashPass(pass, r.salt);
        if (!timingSafeEqual(h, r.hash)) {
          const ff = failures.get(ip) || { n: 0, until: 0 }; ff.n++; if (ff.n >= 6) { ff.until = now + 60000; ff.n = 0; } failures.set(ip, ff);
          return send(ws, { t: 'err', msg: 'Wrong password for this room.' }), ws.close();
        }
        if (r.clients.size >= MAX_PER_ROOM) return send(ws, { t: 'err', msg: 'Room is full.' }), ws.close();
      }
      failures.delete(ip);
      room = r; room.name = name;
      me = { id: nextId++, name: clean(m.name, 16) || 'Climber', col: (m.col | 0) % 8, s: null };
      const others = [...r.clients.values()].map((c) => ({ id: c.me.id, name: c.me.name, col: c.me.col, s: c.me.s }));
      r.clients.set(me.id, ws); ws.me = me;
      send(ws, { t: 'welcome', id: me.id, now: Date.now(), created, players: others });
      for (const [id, c] of r.clients) if (id !== me.id) send(c, { t: 'join', id: me.id, name: me.name, col: me.col });
      return;
    }
    switch (m.t) {
      case 'ping': send(ws, { t: 'pong', c: m.c, now: Date.now() }); break;
      case 's': { // state: p=[x,y,z], r=yaw, a=anim, v=speed, l=level
        if (!Array.isArray(m.p) || m.p.length !== 3 || !m.p.every(Number.isFinite)) return;
        me.s = { p: m.p.map((n) => Math.round(n * 100) / 100), r: +m.r || 0, a: clean(m.a, 8), v: +m.v || 0, l: m.l | 0 };
        const out = JSON.stringify({ t: 's', id: me.id, ...me.s });
        for (const [id, c] of room.clients) if (id !== me.id && c.readyState === 1) c.send(out);
        break;
      }
      case 'chat': {
        const text = clean(m.m, 140); if (!text) return;
        const out = JSON.stringify({ t: 'chat', id: me.id, name: me.name, m: text });
        for (const c of room.clients.values()) if (c.readyState === 1) c.send(out);
        break;
      }
      case 'cp': case 'summit': {
        const out = JSON.stringify({ t: m.t, id: me.id, name: me.name, l: m.l | 0 });
        for (const [id, c] of room.clients) if (id !== me.id && c.readyState === 1) c.send(out);
        break;
      }
    }
  });
  ws.on('close', () => {
    if (!room || !me) return;
    room.clients.delete(me.id);
    for (const c of room.clients.values()) send(c, { t: 'leave', id: me.id });
    if (!room.clients.size) rooms.delete(room.name);
  });
});

setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 15000);
server.listen(port, () => console.log(`ASCENT relay + game on http://localhost:${port}`));
