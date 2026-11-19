// Relay client: password-protected rooms over WebSocket.
export class Net {
  constructor() { this.ws = null; this.on = {}; this.offset = 0; this.rtt = 0; this.id = null; this.connected = false; }
  serverTime() { return (Date.now() + this.offset) / 1000; }
  emit(t, d) { const f = this.on[t]; if (f) f(d); }
  connect(url, join) {
    return new Promise((resolve, reject) => {
      let settled = false, ws;
      try { ws = new WebSocket(url); } catch (e) { reject(new Error('Bad relay address')); return; }
      this.ws = ws;
      const timer = setTimeout(() => { if (!settled) { settled = true; try { ws.close(); } catch {} reject(new Error('Relay timed out')); } }, 7000);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'join', ...join }));
      ws.onerror = () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Could not reach relay')); } };
      ws.onclose = () => { this.connected = false; clearInterval(this.pinger); if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Relay closed the connection')); } else this.emit('close'); };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'welcome') {
          this.id = m.id; this.connected = true; this.offset = m.now - Date.now(); settled = true; clearTimeout(timer);
          this.pinger = setInterval(() => this.send({ t: 'ping', c: Date.now() }), 4000);
          this.send({ t: 'ping', c: Date.now() });
          resolve(m);
        } else if (m.t === 'err') { if (!settled) { settled = true; clearTimeout(timer); reject(new Error(m.msg)); } else this.emit('err', m); }
        else if (m.t === 'pong') {
          const rtt = Date.now() - m.c; this.rtt = rtt;
          const off = m.now + rtt / 2 - Date.now();
          this.offset = this.offset * 0.5 + off * 0.5;
        } else this.emit(m.t, m);
      };
    });
  }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  close() { try { this.ws && this.ws.close(); } catch {} this.connected = false; }
}
