/**
 * A direct WebRTC link between a guest and the host, set up through the relay. The relay is a public broker in one place, so
 * every update through it makes two trips (you -> broker -> them) over TCP, where one lost packet holds up everything behind
 * it. A direct link is one trip, and car states go on an unordered channel with no resends: a lost update is simply skipped
 * and the next one arrives on time. A second, reliable channel is there for anything that must arrive.
 *
 * Setup: the guest makes an offer, both sides gather their addresses (via free public STUN servers) and swap them in one relay
 * message each. Some networks (strict mobile or office NATs) cannot be reached directly without a paid TURN server; then the
 * link never opens and the game simply stays on the relay.
 */
const ICE = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
const OPEN_TIMEOUT = 12000, GATHER_WAIT = 2500, MAX_BUFFERED = 64 * 1024;

export const rtcSupported = () => typeof RTCPeerConnection !== 'undefined';

export class PeerLink {
  /**
   * initiator: true on the guest (makes the offer). signal(d): send d to the other side through the relay.
   * onMessage(obj): a message arrived directly. onChange(): the link opened or failed.
   */
  constructor({ initiator, signal, onMessage, onChange }) {
    this.signal = signal; this.onMessage = onMessage; this.onChange = onChange;
    this.state = 'connecting';      // 'connecting' | 'open' | 'failed' | 'closed'
    this.sent = 0; this.received = 0;
    const pc = this.pc = new RTCPeerConnection({ iceServers: ICE });
    if (initiator) {
      this._chan(pc.createDataChannel('st', { ordered: false, maxRetransmits: 0 }));
      this._chan(pc.createDataChannel('rel', { ordered: true }));
    } else pc.ondatachannel = (e) => this._chan(e.channel);
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'failed') this._end('failed');
      else if (s === 'disconnected') { clearTimeout(this._dis); this._dis = setTimeout(() => { if (pc.connectionState === 'disconnected') this._end('failed'); }, 4000); }
    };
    this._timer = setTimeout(() => { if (this.state === 'connecting') this._end('failed'); }, OPEN_TIMEOUT);
  }

  get open() { return this.state === 'open'; }

  _chan(ch) {
    if (ch.label === 'st') this.fast = ch; else this.safe = ch;
    ch.onopen = () => { if (this.fast?.readyState === 'open' && this.safe?.readyState === 'open' && this.state === 'connecting') { this.state = 'open'; clearTimeout(this._timer); this.onChange?.(); } };
    ch.onclose = () => { if (this.state === 'open') this._end('failed'); };
    ch.onmessage = (e) => { this.received++; try { this.onMessage?.(JSON.parse(e.data)); } catch { /* not ours */ } };
  }

  /** set our side's description and wait (briefly) for every address, so it all goes in one relay message */
  async _local(desc) {
    await this.pc.setLocalDescription(desc);
    if (this.pc.iceGatheringState !== 'complete') {
      await new Promise((resolve) => {
        const t = setTimeout(resolve, GATHER_WAIT);
        this.pc.addEventListener('icegatheringstatechange', () => { if (this.pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); } });
      });
    }
    const d = this.pc.localDescription;
    return { type: d.type, sdp: d.sdp };
  }

  /** guest: start the handshake */
  async start() {
    try { this.signal({ sdp: await this._local(await this.pc.createOffer()) }); } catch { this._end('failed'); }
  }

  /** a handshake message from the other side */
  async handle(d) {
    if (!d?.sdp || this.state === 'closed' || this.state === 'failed') return;
    try {
      await this.pc.setRemoteDescription(d.sdp);
      if (d.sdp.type === 'offer') this.signal({ sdp: await this._local(await this.pc.createAnswer()) });
    } catch { this._end('failed'); }
  }

  /** unreliable: a car state (skipped rather than queued if the link is backed up) */
  send(obj, unreliable = false) {
    if (!this.open) return false;
    const ch = unreliable ? this.fast : this.safe;
    if (ch?.readyState !== 'open' || (unreliable && ch.bufferedAmount > MAX_BUFFERED)) return false;
    try { ch.send(JSON.stringify(obj)); this.sent++; return true; } catch { return false; }
  }

  _end(state) {
    if (this.state === 'closed' || this.state === 'failed') return;
    const was = this.state;
    this.state = state; clearTimeout(this._timer); clearTimeout(this._dis);
    try { this.pc.close(); } catch { /* ignore */ }
    if (was !== state) this.onChange?.();
  }

  close() { this._end('closed'); }
}
