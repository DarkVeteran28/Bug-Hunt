// Pedestrians walk looping routes using the teleporting-npc challenge
// function. Mission NPCs (Rico and Vera) stand still and can be talked to.
import { PEDESTRIAN_ROUTES, MISSION_NPCS } from '../../shared/world-data.js';
import { callRaw } from './challenge-runtime.js';
import { createCharacter } from './character.js';

const COLORS = ['#ffd6a5', '#a0e7e5', '#ffb3c7', '#cdb4db', '#b5ead7', '#ff9aa2', '#c7ceea'];

export class NpcManager {
  constructor(scene, { shadows }) {
    this.peds = [];
    let seed = 3;
    PEDESTRIAN_ROUTES.forEach((route, ri) => {
      const waypoints = route.points.map(([x, z]) => ({ x, z }));
      for (let k = 0; k < 2; k++) {
        const start = (k * 2) % waypoints.length;
        const ch = createCharacter({ color: COLORS[(ri * 2 + k) % COLORS.length], seed: seed++, shadows: false });
        scene.add(ch.root);
        this.peds.push({
          ch,
          waypoints,
          npc: { position: { ...waypoints[start] }, index: (start + 1) % waypoints.length, speed: 1.3 + ((ri + k) % 3) * 0.25 },
          lastPos: { ...waypoints[start] },
          errors: 0,
        });
      }
    });
    this.missionNpcs = MISSION_NPCS.map((n, i) => {
      const ch = createCharacter({ color: n.color, name: n.name, seed: 10 + i, shadows });
      ch.root.position.set(n.pos[0], 0, n.pos[2]);
      scene.add(ch.root);
      return { ...n, ch };
    });
    this.teleports = 0;
  }

  update(dt, playerPos) {
    for (const p of this.peds) {
      // Skip far-away pedestrians to save time.
      const far = Math.hypot(p.npc.position.x - playerPos.x, p.npc.position.z - playerPos.z) > 180;
      p.ch.root.visible = !far;
      if (far) continue;
      let next;
      try {
        next = callRaw('teleporting-npc', [p.npc, p.waypoints, dt]);
        if (!next || !next.position || !Number.isFinite(next.position.x) || !Number.isFinite(next.position.z) || !Number.isInteger(next.index) || !p.waypoints[next.index]) {
          throw new Error('invalid npc state');
        }
      } catch {
        // A broken step function sends the NPC back to the start of its route.
        next = { position: { ...p.waypoints[0] }, index: 1 % p.waypoints.length, speed: p.npc.speed };
        this.teleports++;
      }
      const dx = next.position.x - p.npc.position.x;
      const dz = next.position.z - p.npc.position.z;
      const moved = Math.hypot(dx, dz);
      p.npc = { position: { x: next.position.x, z: next.position.z }, index: next.index, speed: p.npc.speed };
      if (moved > 0.0001) p.ch.root.rotation.y = Math.atan2(dx, dz);
      p.ch.root.position.set(p.npc.position.x, 0, p.npc.position.z);
      p.ch.animate(dt, moved > 0.0001 ? 'walk' : 'idle');
    }
    for (const n of this.missionNpcs) {
      n.ch.root.rotation.y = Math.atan2(playerPos.x - n.pos[0], playerPos.z - n.pos[2]);
      n.ch.animate(dt, 'idle');
    }
  }

  nearestMissionNpc(pos, range = 3.8) {
    let best = null;
    let bestD = range;
    for (const n of this.missionNpcs) {
      const d = Math.hypot(n.pos[0] - pos.x, n.pos[2] - pos.z);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }
}
