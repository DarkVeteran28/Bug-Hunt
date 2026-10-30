// Things to pick up by walking over them: data chips (collectibles, once
// each, saved), med kits and ammo crates (come back after a while).
// All of them sit on streets, which are clear of buildings.
import { DISTRICTS, DISTRICT_WIDTH, dist2D } from '../shared/world-data.js';

export const PICKUP = Object.freeze({
  radius: 1.6,
  chipPoints: 25,
  medkitHeal: 40,
  respawnMs: 45_000,
});

// District-local positions.
const CHIPS = [[-30, -70], [60, 20], [-30, 50]];
const MEDKITS = [[0, -40]];
const AMMO = [[-60, 20]];

export function pickupSpawns() {
  const list = [];
  DISTRICTS.forEach((d, di) => {
    const at = ([x, z]) => [di * DISTRICT_WIDTH + x, 0, z];
    CHIPS.forEach((p, k) => list.push({ id: `chip-${d.id}-${k + 1}`, kind: 'chip', district: d.id, pos: at(p) }));
    MEDKITS.forEach((p, k) => list.push({ id: `med-${d.id}-${k + 1}`, kind: 'medkit', district: d.id, pos: at(p) }));
    AMMO.forEach((p, k) => list.push({ id: `ammo-${d.id}-${k + 1}`, kind: 'ammo', district: d.id, pos: at(p) }));
  });
  return list;
}

export const CHIP_COUNT = pickupSpawns().filter((p) => p.kind === 'chip').length;

export class Pickups {
  constructor({ now }) {
    this.now = now;
    this.items = pickupSpawns().map((p) => ({ ...p, availableAt: 0 }));
  }

  /** Items the player is standing on and could take now. */
  touching(pos, collected) {
    const t = this.now();
    return this.items.filter((p) => dist2D(p.pos, pos) <= PICKUP.radius && Math.abs(pos[1] - p.pos[1]) < 2.5 && t >= p.availableAt && !(p.kind === 'chip' && collected.includes(p.id)));
  }

  take(item) {
    if (item.kind !== 'chip') item.availableAt = this.now() + PICKUP.respawnMs;
  }

  view(collected) {
    const t = this.now();
    return this.items.map((p) => ({ id: p.id, kind: p.kind, pos: p.pos, visible: t >= p.availableAt && !(p.kind === 'chip' && collected.includes(p.id)) }));
  }
}
