// Socket.IO client: connection, room joining, automatic re-join after a
// dropped connection, and remote-player interpolation buffers.
import { io } from 'socket.io-client';
import { NET } from '/shared/config.js';
import { call } from './challenge-runtime.js';

export class Network {
  constructor() {
    this.socket = null;
    this.handlers = new Map();
    this.roomCode = null;
    this.serverOffset = null;
    this.connected = false;
    this.joinOptions = null;
  }

  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(fn);
    if (this.socket) this.socket.on(event, fn);
  }

  connect({ name, token }) {
    return new Promise((resolve, reject) => {
      const socket = io({ auth: { name, token }, transports: ['websocket', 'polling'], reconnectionDelayMax: 4000 });
      this.socket = socket;
      for (const [event, fns] of this.handlers) for (const fn of fns) socket.on(event, fn);
      let first = true;
      socket.on('welcome', (w) => {
        // Future reconnects authenticate with the token only.
        socket.auth = { token: w.token, name };
        if (first) {
          first = false;
          resolve(w);
        }
      });
      socket.on('fatal', (e) => {
        if (first) reject(new Error(e.error));
      });
      socket.on('connect', () => {
        this.connected = true;
        this.emitLocal('net', { connected: true });
        if (this.roomCode) {
          // Resume the same room after a reconnect.
          this.request('room:join', { code: this.roomCode }).then((r) => this.emitLocal('rejoined', r));
        }
      });
      socket.on('disconnect', () => {
        this.connected = false;
        this.emitLocal('net', { connected: false });
      });
      socket.on('connect_error', (e) => {
        if (first && !socket.active) reject(e);
      });
      socket.on('s', (snap) => this.trackClock(snap.t));
    });
  }

  emitLocal(event, data) {
    for (const fn of this.handlers.get(`local:${event}`) || []) fn(data);
  }

  onLocal(event, fn) {
    this.on(`local:${event}`, fn);
  }

  trackClock(serverT) {
    const sample = serverT - performance.now();
    if (this.serverOffset === null || sample > this.serverOffset) this.serverOffset = sample;
    else this.serverOffset += (sample - this.serverOffset) * 0.02;
  }

  serverNow() {
    return performance.now() + (this.serverOffset || 0);
  }

  emit(event, data) {
    if (this.socket && this.connected) this.socket.emit(event, data);
  }

  request(event, data, timeoutMs = 8000) {
    return new Promise((resolve) => {
      if (!this.socket) return resolve({ ok: false, error: 'Not connected.' });
      this.socket.timeout(timeoutMs).emit(event, data, (err, res) => {
        if (err) resolve({ ok: false, error: 'The server did not answer in time.' });
        else resolve(res);
      });
    });
  }

  async join(options) {
    const r = await this.request('room:join', options);
    if (r && r.ok) this.roomCode = r.room.code;
    return r;
  }

  leave() {
    this.roomCode = null;
    if (this.socket) this.socket.disconnect();
  }
}

/** Buffer of server snapshots for one remote player. */
export class RemoteState {
  constructor() {
    this.buffer = [];
    this.latest = null;
  }

  push(t, x, y, z) {
    const last = this.buffer[this.buffer.length - 1];
    if (last && t <= last.t) return;
    this.buffer.push({ t, x, y, z });
    if (this.buffer.length > 40) this.buffer.shift();
    this.latest = { x, y, z };
  }

  /** Interpolated position at renderTime, using the frozen-player challenge function. */
  sample(renderTime) {
    const fallback = this.latest;
    const r = call('frozen-player', [this.buffer, renderTime], fallback);
    if (!r || ![r.x, r.y, r.z].every(Number.isFinite)) return fallback;
    return r;
  }
}

export const INTERP_DELAY = NET.interpolationDelayMs;
