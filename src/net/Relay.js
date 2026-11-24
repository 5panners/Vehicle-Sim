/**
 * Relay transport: a tiny MQTT 3.1.1 client over secure WebSockets talking to a free public
 * broker. Everyone who types the same password ends up subscribed to the same topic (the
 * password is SHA-256 hashed, so it never leaves the browser), and every message published
 * there is relayed to all of them. QoS 0 only: fire-and-forget, which is what game state wants.
 *
 * The broker sees the (hashed) topic and the game messages; nothing personal is sent.
 */
/**
 * Free public brokers, fastest first. `limit`: messages a second each passes per connection (more is silently dropped
 * there), so a token bucket keeps us under it. Measured from the UK: test.mosquitto.org about 18 ms one way and no drops
 * at 20 Hz; broker.emqx.io about 165 ms and drops above 10 a second. Everyone in a match must end up on the same one:
 * 'auto' tries them in this order.
 */
export const BROKERS = [
  { id: 'mosquitto', name: 'test.mosquitto.org', url: 'wss://test.mosquitto.org:8081/mqtt', limit: 24 },
  { id: 'emqx', name: 'broker.emqx.io', url: 'wss://broker.emqx.io:8084/mqtt', limit: 9.5 },
];
const BURST = 3;

const enc = new TextEncoder(), dec = new TextDecoder();
const str = (s) => { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; };
const remLen = (n) => { const out = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; out.push(d); } while (n > 0); return out; };
const packet = (type, body) => new Uint8Array([type, ...remLen(body.length), ...body]);

export async function roomTopic(password) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode('vehicle-sim|' + password.trim()));
  return 'vsim/v1/' + [...new Uint8Array(h)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class Relay {
  constructor({ onMessage, onClose } = {}) {
    this.onMessage = onMessage; this.onClose = onClose;
    this.ws = null; this.topic = null; this.buf = new Uint8Array(0); this.open = false; this.broker = null;
    this._pid = 1; this._ping = null; this.sent = 0; this.received = 0; this.skipped = 0;
    this._tokens = BURST; this._refill = performance.now(); this.limit = 9.5;
  }

  /** connect to the chosen broker ('auto': the first that answers) and join the room; resolves with the broker */
  async connect(password, choice = 'auto') {
    this.topic = await roomTopic(password);
    let lastErr = null;
    const list = choice === 'auto' ? BROKERS : BROKERS.filter((b) => b.id === choice);
    for (const b of list) {
      try { await this._connectTo(b.url); this.broker = b; this.limit = b.limit; return b; } catch (e) { lastErr = e; this._teardown(); }
    }
    throw lastErr || new Error('no relay reachable');
  }

  _connectTo(url) {
    return new Promise((resolve, reject) => {
      const ws = this.ws = new WebSocket(url, 'mqtt');
      ws.binaryType = 'arraybuffer';
      const timer = setTimeout(() => reject(new Error('relay timed out')), 6000);
      const clientId = 'vsim-' + Math.random().toString(36).slice(2, 12);
      ws.onopen = () => {
        // CONNECT: protocol "MQTT" level 4, clean session, 30 s keep-alive
        ws.send(packet(0x10, [...str('MQTT'), 4, 0x02, 0, 30, ...str(clientId)]));
      };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('relay unreachable')); };
      ws.onclose = () => {
        clearTimeout(timer);
        if (this.open) { this.open = false; clearInterval(this._ping); this.onClose?.(); } else reject(new Error('relay closed the connection'));
      };
      this._onConnack = (ok) => {
        clearTimeout(timer);
        if (!ok) { reject(new Error('relay refused the connection')); return; }
        this.open = true;
        const id = this._pid++;
        ws.send(packet(0x82, [id >> 8, id & 255, ...str(this.topic), 0]));   // SUBSCRIBE at QoS 0
        this._ping = setInterval(() => { if (ws.readyState === 1) ws.send(new Uint8Array([0xc0, 0])); }, 20000);
        resolve();
      };
      ws.onmessage = (e) => this._data(new Uint8Array(e.data));
    });
  }

  _data(chunk) {
    const b = new Uint8Array(this.buf.length + chunk.length); b.set(this.buf); b.set(chunk, this.buf.length); this.buf = b;
    for (;;) {
      if (this.buf.length < 2) return;
      let len = 0, mul = 1, i = 1, byte;
      do { if (i >= this.buf.length) return; byte = this.buf[i++]; len += (byte & 127) * mul; mul *= 128; } while (byte & 128);
      if (this.buf.length < i + len) return;
      const hdr = this.buf[0], type = hdr >> 4, body = this.buf.slice(i, i + len);
      this.buf = this.buf.slice(i + len);
      if (type === 2) this._onConnack?.(body[1] === 0);                       // CONNACK
      else if (type === 3) {                                                   // PUBLISH (we subscribe at QoS 0, so no packet id)
        const tl = (body[0] << 8) | body[1], qos = (hdr >> 1) & 3;
        const payload = body.subarray(2 + tl + (qos ? 2 : 0));
        this.received++;
        try { this.onMessage?.(JSON.parse(dec.decode(payload))); } catch { /* not ours */ }
      }
    }
  }

  /** droppable: state updates, skipped when the bucket is empty so lobby, start and leave messages always get through */
  send(obj, droppable = false) {
    if (!this.open || this.ws?.readyState !== 1) return false;
    const now = performance.now();
    this._tokens = Math.min(BURST, this._tokens + (now - this._refill) / 1000 * this.limit); this._refill = now;
    if (droppable && this._tokens < 1) { this.skipped++; return false; }
    this._tokens -= 1;
    const payload = enc.encode(JSON.stringify(obj));
    this.ws.send(packet(0x30, [...str(this.topic), ...payload]));
    this.sent++;
    return true;
  }

  close() {
    if (this.ws?.readyState === 1) { try { this.ws.send(new Uint8Array([0xe0, 0])); } catch { /* closing anyway */ } }
    this.open = false; this._teardown();
  }

  _teardown() { clearInterval(this._ping); if (this.ws) { this.ws.onclose = null; this.ws.onmessage = null; try { this.ws.close(); } catch { /* ignore */ } } this.ws = null; this.buf = new Uint8Array(0); }
}
