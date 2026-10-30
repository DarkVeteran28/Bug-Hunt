// Draws the glitch bots. The engine moves them; this view receives position
// reports from the "tracking relay" 10 times a second and draws each bot
// between reports with the player's Frozen Bots function (frozen-player
// challenge). Before that bug is fixed the bots stutter, as the challenge says.
//
// One character model per bot is built once and reused through death and
// respawn (no per-frame allocation). Bots far from the camera skip animation.
import * as THREE from 'three';
import { RELAY } from '../../shared/config.js';
import { createCharacter } from './character.js';
import { call } from './challenge-runtime.js';

const REPORT_MS = 1000 / RELAY.reportHz;

export class EnemyView {
  constructor(scene, { shadows = false, detailRange = 130 } = {}) {
    this.scene = scene;
    this.shadows = shadows;
    this.detailRange = detailRange;
    this.bots = new Map();
    this.lastReport = -Infinity;
    this.tmp = new THREE.Vector3();
  }

  ensure(e) {
    let b = this.bots.get(e.id);
    if (b) return b;
    const ch = createCharacter({ color: '#e0283c', name: e.name, seed: e.id.length, shadows: this.shadows });
    ch.setWeapon('pistol');
    ch.root.userData.enemyId = e.id;
    this.scene.add(ch.root);
    b = { id: e.id, ch, buffer: [], latest: null, pos: new THREE.Vector3(...e.pos), alive: e.alive, deadFor: 0, flash: 0 };
    this.bots.set(e.id, b);
    return b;
  }

  /** Called every frame with the engine's enemy list and game clock. */
  update(dt, enemies, clockMs, cameraPos) {
    const report = clockMs - this.lastReport >= REPORT_MS || clockMs < this.lastReport;
    if (report) this.lastReport = clockMs;
    const renderTime = clockMs - RELAY.interpolationDelayMs;
    for (const e of enemies) {
      const b = this.ensure(e);
      if (report) {
        // A respawn is a jump, not a slide: start a fresh buffer.
        if (e.alive && !b.alive) b.buffer.length = 0;
        b.buffer.push({ t: clockMs, x: e.pos[0], y: e.pos[1], z: e.pos[2] });
        if (b.buffer.length > RELAY.bufferSize) b.buffer.shift();
        b.latest = b.buffer[b.buffer.length - 1];
      }
      b.alive = e.alive;
      const p = call('frozen-player', [b.buffer, renderTime], b.latest);
      const ok = p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
      const q = ok ? p : b.latest || { x: e.pos[0], y: e.pos[1], z: e.pos[2] };
      b.pos.set(q.x, q.y, q.z);

      const root = b.ch.root;
      b.deadFor = e.alive ? 0 : b.deadFor + dt;
      root.visible = e.alive || b.deadFor < 4;
      if (!root.visible) continue;
      root.position.copy(b.pos);
      root.rotation.y = e.ry;
      const near = cameraPos.distanceTo(b.pos) < this.detailRange;
      if (near || !e.alive) b.ch.animate(dt, e.alive ? e.anim : 'dead');
      b.flash = Math.max(0, b.flash - dt);
      b.ch.setShield(b.flash > 0, '#ffffff');
    }
  }

  hit(id) {
    const b = this.bots.get(id);
    if (b) b.flash = 0.12;
  }

  /** Boxes around the bots as drawn, so the crosshair can stop on them. */
  boxes() {
    const out = [];
    for (const b of this.bots.values()) {
      if (!b.alive || !b.ch.root.visible) continue;
      out.push(new THREE.Box3(new THREE.Vector3(b.pos.x - 0.45, b.pos.y, b.pos.z - 0.45), new THREE.Vector3(b.pos.x + 0.45, b.pos.y + 1.85, b.pos.z + 0.45)));
    }
    return out;
  }

  minimapDots() {
    const out = [];
    for (const b of this.bots.values()) if (b.alive) out.push({ x: b.pos.x, z: b.pos.z, color: '#ff4f5e' });
    return out;
  }

  dispose() {
    for (const b of this.bots.values()) {
      this.scene.remove(b.ch.root);
      b.ch.dispose();
    }
    this.bots.clear();
  }
}
