// Minimap: a pre-rendered top-down city image, cropped around the player,
// with gates, stations, mission targets, vehicles and players drawn on top.
import { getWorld, WORLD, AVENUES_Z, CROSS_LOCAL_X, ROAD_HALF, DISTRICTS, districtCenterX, STATIONS } from '/shared/world-data.js';

const SCALE = 1.2; // pixels per world unit on the base image

export class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.base = document.createElement('canvas');
    this.base.width = Math.ceil((WORLD.maxX - WORLD.minX + 40) * SCALE);
    this.base.height = Math.ceil((WORLD.maxZ - WORLD.minZ + 80) * SCALE);
    this.drawBase();
    this.viewRadius = 70;
  }

  toBase(x, z) {
    // North (+z) is up on the map.
    return [(x - WORLD.minX + 20) * SCALE, (WORLD.maxZ + 20 - z) * SCALE];
  }

  drawBase() {
    const g = this.base.getContext('2d');
    g.fillStyle = '#1aa3b8';
    g.fillRect(0, 0, this.base.width, this.base.height);
    let [x0, y0] = this.toBase(WORLD.minX, WORLD.maxZ);
    let [x1, y1] = this.toBase(WORLD.maxX, WORLD.waterZ);
    g.fillStyle = '#2a2135';
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    [x0, y0] = this.toBase(WORLD.minX, WORLD.beachZ);
    g.fillStyle = '#e9c48c';
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.fillStyle = '#4a4058';
    for (const z of AVENUES_Z) {
      const [a, b] = this.toBase(WORLD.minX, z + ROAD_HALF);
      const [c] = this.toBase(WORLD.maxX, z);
      g.fillRect(a, b, c - a, ROAD_HALF * 2 * SCALE);
    }
    for (const d of DISTRICTS) for (const lx of CROSS_LOCAL_X) {
      const [a, b] = this.toBase(districtCenterX(d.index) + lx - ROAD_HALF, WORLD.maxZ);
      const [, c] = this.toBase(0, WORLD.beachZ);
      g.fillRect(a, b, ROAD_HALF * 2 * SCALE, c - b);
    }
    const w = getWorld();
    for (const b of w.buildings) {
      const [a, c] = this.toBase(b.min[0], b.max[2]);
      g.fillStyle = b.ghost ? '#ff9ecf' : b.kind === 'container' ? '#7a5a6a' : '#6b5a85';
      g.fillRect(a, c, (b.max[0] - b.min[0]) * SCALE, (b.max[2] - b.min[2]) * SCALE);
    }
    g.fillStyle = '#c9b7d9';
    for (const wl of [...w.walls.filter((x) => !x.invisible), ...w.vault.walls]) {
      const [a, c] = this.toBase(wl.min[0], wl.max[2]);
      g.fillRect(a, c, Math.max(1.5, (wl.max[0] - wl.min[0]) * SCALE), Math.max(1.5, (wl.max[2] - wl.min[2]) * SCALE));
    }
  }

  draw({ me, yaw, players, vehicles, gatesOpen, stationStates, target }) {
    const g = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const [px, py] = this.toBase(me.x, me.z);
    const span = this.viewRadius * SCALE * 2;
    g.save();
    g.clearRect(0, 0, W, H);
    g.beginPath();
    g.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2);
    g.clip();
    g.drawImage(this.base, px - span / 2, py - span / 2, span, span, 0, 0, W, H);
    const k = W / span;
    const toScreen = (x, z) => {
      const [bx, by] = this.toBase(x, z);
      return [(bx - px) * k + W / 2, (by - py) * k + H / 2];
    };
    const w = getWorld();
    for (const gate of w.gates) {
      const [a, b] = toScreen((gate.min[0] + gate.max[0]) / 2, (gate.min[2] + gate.max[2]) / 2);
      g.fillStyle = gatesOpen.includes(gate.id) ? '#4dff9a' : '#ff4f5e';
      g.fillRect(a - 3, b - 6, 6, 12);
    }
    for (const st of STATIONS) {
      const [a, b] = toScreen(st.pos[0], st.pos[2]);
      const s = stationStates[st.challengeId];
      g.fillStyle = s === 'solved' ? '#4dff9a' : s === 'locked' ? '#777' : '#ffd23f';
      g.beginPath();
      g.arc(a, b, 4, 0, Math.PI * 2);
      g.fill();
    }
    for (const v of vehicles) {
      const [a, b] = toScreen(v.x, v.z);
      g.fillStyle = v.color;
      g.fillRect(a - 2.5, b - 2.5, 5, 5);
    }
    if (target) {
      const [a, b] = toScreen(target[0], target[2]);
      const cx = Math.max(10, Math.min(W - 10, a));
      const cy = Math.max(10, Math.min(H - 10, b));
      g.strokeStyle = '#ffd23f';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(cx, cy, 6, 0, Math.PI * 2);
      g.stroke();
    }
    for (const p of players) {
      const [a, b] = toScreen(p.x, p.z);
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(a, b, 3.5, 0, Math.PI * 2);
      g.fill();
    }
    // Player arrow: the map is north-up (+z up) and the camera faces (-sin yaw, -cos yaw).
    g.translate(W / 2, H / 2);
    g.rotate(yaw + Math.PI);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(0, -8);
    g.lineTo(5, 6);
    g.lineTo(0, 3);
    g.lineTo(-5, 6);
    g.closePath();
    g.fill();
    g.restore();
  }
}
