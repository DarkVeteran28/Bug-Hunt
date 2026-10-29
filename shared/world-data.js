// Deterministic, original city layout shared by the client (rendering and
// physics) and the server (line-of-sight, movement and interaction checks).
// Everything here is plain data built from a seeded RNG, so both sides agree.

export const DISTRICT_WIDTH = 180;
export const WORLD = Object.freeze({
  minX: -90,
  maxX: 4 * DISTRICT_WIDTH + 90,
  minZ: -118,
  maxZ: 90,
  beachZ: -80, // sand starts south of here
  waterZ: -100, // ocean starts south of here
  killY: -20,
});

export const DISTRICTS = Object.freeze([
  { index: 0, id: 'ocean', name: 'Ocean Drive', mandatory: 'invisible-gate', palette: ['#ffb3c7', '#ffd6a5', '#a0e7e5', '#fdfd96', '#cdb4db', '#ffffff'] },
  { index: 1, id: 'downtown', name: 'Downtown', mandatory: 'broken-mission', palette: ['#6c7a89', '#8395a7', '#576574', '#c8d6e5', '#54a0ff', '#222f3e'] },
  { index: 2, id: 'port', name: 'Vice Port', mandatory: 'flying-car', palette: ['#b33939', '#227093', '#cc8e35', '#84817a', '#2c2c54', '#218c74'] },
  { index: 3, id: 'neon', name: 'Neon District', mandatory: 'double-score', palette: ['#2d1b4e', '#3c1f5c', '#1f1147', '#4a1a5c', '#251a3f', '#14102b'] },
  { index: 4, id: 'industrial', name: 'Industrial Zone', mandatory: 'broken-final-gate', palette: ['#7f8c8d', '#95a5a6', '#6d6875', '#b5838d', '#5c5c5c', '#a68a64'] },
]);

export const AVENUES_Z = Object.freeze([-70, -10, 50]);
export const CROSS_LOCAL_X = Object.freeze([-60, 0, 60]);
export const ROAD_HALF = 6;
const SIDEWALK = 2.5;

export function districtCenterX(i) {
  return i * DISTRICT_WIDTH;
}

export function districtIndexAt(x) {
  const i = Math.floor((x - WORLD.minX) / DISTRICT_WIDTH);
  return Math.max(0, Math.min(DISTRICTS.length - 1, i));
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function box(minX, minY, minZ, maxX, maxY, maxZ) {
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

// Blocks are the rectangles between roads, in district-local x.
const BLOCK_X = [
  [-88.5, -60 - ROAD_HALF],
  [-60 + ROAD_HALF, 0 - ROAD_HALF],
  [0 + ROAD_HALF, 60 - ROAD_HALF],
  [60 + ROAD_HALF, 88.5],
];
const BLOCK_Z = [
  [-70 + ROAD_HALF, -10 - ROAD_HALF],
  [-10 + ROAD_HALF, 50 - ROAD_HALF],
  [50 + ROAD_HALF, 88.5],
];

// Plazas stay free of generated buildings: they hold spawns, stations and
// mission props. Indices are [blockX, blockZ].
const PLAZAS = {
  ocean: [2, 0],
  downtown: [1, 0],
  port: [2, 0],
  neon: [1, 1],
  industrial: [2, 2],
};

function buildDistrictBuildings(d, rand, out) {
  const cx = districtCenterX(d.index);
  for (let bx = 0; bx < BLOCK_X.length; bx++) {
    for (let bz = 0; bz < BLOCK_Z.length; bz++) {
      const plaza = PLAZAS[d.id];
      if (plaza[0] === bx && plaza[1] === bz) continue;
      const [x0, x1] = BLOCK_X[bx];
      const [z0, z1] = BLOCK_Z[bz];
      const minX = cx + x0 + SIDEWALK;
      const maxX = cx + x1 - SIDEWALK;
      const minZ = z0 + SIDEWALK;
      const maxZ = z1 - SIDEWALK;
      if (d.id === 'port' && (bx + bz) % 2 === 0) {
        buildContainerYard(d, rand, minX, maxX, minZ, maxZ, out);
        continue;
      }
      // Split the block into 1-3 lots along its longer side.
      const width = maxX - minX;
      const depth = maxZ - minZ;
      const alongX = width >= depth;
      const lots = Math.max(1, Math.min(3, Math.floor((alongX ? width : depth) / 14)));
      const span = (alongX ? width : depth) / lots;
      for (let l = 0; l < lots; l++) {
        const gap = 1.5;
        let lx0 = alongX ? minX + l * span + gap : minX;
        let lx1 = alongX ? minX + (l + 1) * span - gap : maxX;
        let lz0 = alongX ? minZ : minZ + l * span + gap;
        let lz1 = alongX ? maxZ : minZ + (l + 1) * span - gap;
        // Keep some setback variety.
        const inset = rand() * 2;
        lx0 += inset; lx1 -= inset; lz0 += inset; lz1 -= inset;
        if (lx1 - lx0 < 4 || lz1 - lz0 < 4) continue;
        const h = buildingHeight(d.id, rand);
        out.push({
          id: `b-${d.id}-${bx}${bz}${l}`,
          district: d.id,
          kind: d.id === 'port' ? 'warehouse' : d.id === 'industrial' ? 'factory' : 'building',
          color: d.palette[Math.floor(rand() * d.palette.length)],
          neon: d.id === 'neon' || (d.id === 'ocean' && rand() < 0.35),
          ...box(lx0, 0, lz0, lx1, h, lz1),
        });
      }
    }
  }
}

function buildingHeight(id, rand) {
  switch (id) {
    case 'ocean': return 8 + rand() * 14;
    case 'downtown': return 24 + rand() * 40;
    case 'port': return 8 + rand() * 5;
    case 'neon': return 10 + rand() * 18;
    default: return 9 + rand() * 9;
  }
}

function buildContainerYard(d, rand, minX, maxX, minZ, maxZ, out) {
  const colors = ['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad', '#16a085'];
  let n = 0;
  for (let x = minX + 1; x + 6.1 < maxX; x += 9) {
    for (let z = minZ + 1; z + 2.5 < maxZ; z += 5.5) {
      if (rand() < 0.3) continue;
      const stack = 1 + Math.floor(rand() * 3);
      out.push({
        id: `c-${d.id}-${minX.toFixed(0)}-${n++}`,
        district: d.id,
        kind: 'container',
        color: colors[Math.floor(rand() * colors.length)],
        neon: false,
        ...box(x, 0, z, x + 6.1, stack * 2.6, z + 2.45),
      });
    }
  }
}

function buildWalls() {
  const walls = [];
  const t = 1;
  const h = 8;
  // Outer boundary.
  walls.push({ id: 'w-north', ...box(WORLD.minX - t, 0, WORLD.maxZ, WORLD.maxX + t, h, WORLD.maxZ + t) });
  walls.push({ id: 'w-west', ...box(WORLD.minX - t, 0, WORLD.minZ - t, WORLD.minX, h, WORLD.maxZ + t) });
  walls.push({ id: 'w-east', ...box(WORLD.maxX, 0, WORLD.minZ - t, WORLD.maxX + t, h, WORLD.maxZ + t) });
  walls.push({ id: 'w-south', invisible: true, ...box(WORLD.minX - t, -5, WORLD.minZ - t, WORLD.maxX + t, h, WORLD.minZ) });
  // District barriers with a single gated opening on the middle avenue.
  for (let i = 0; i < DISTRICTS.length - 1; i++) {
    const x = districtCenterX(i) + DISTRICT_WIDTH / 2;
    const g0 = -10 - ROAD_HALF;
    const g1 = -10 + ROAD_HALF;
    walls.push({ id: `w-b${i}-s`, ...box(x - 0.75, 0, WORLD.minZ, x + 0.75, h, g0) });
    walls.push({ id: `w-b${i}-n`, ...box(x - 0.75, 0, g1, x + 0.75, h, WORLD.maxZ) });
  }
  return walls;
}

function buildGates() {
  const gates = [];
  for (let i = 0; i < DISTRICTS.length - 1; i++) {
    const x = districtCenterX(i) + DISTRICT_WIDTH / 2;
    gates.push({
      id: `gate-${DISTRICTS[i + 1].id}`,
      name: `${DISTRICTS[i + 1].name} Gate`,
      unlocksDistrict: DISTRICTS[i + 1].id,
      requiresChallenge: DISTRICTS[i].mandatory,
      panel: [x - 3, 0, -10 - ROAD_HALF - 1.2],
      ...box(x - 0.6, 0, -10 - ROAD_HALF, x + 0.6, 6, -10 + ROAD_HALF),
    });
  }
  // The final vault inside the Industrial Zone plaza.
  const cx = districtCenterX(4);
  gates.push({
    id: 'gate-vault',
    name: 'Final Vault Gate',
    unlocksDistrict: null,
    unlocksVault: true,
    requiresChallenge: 'broken-final-gate',
    panel: [cx + 24, 0, 58],
    ...box(cx + 27, 0, 59.4, cx + 35, 6, 60.6),
  });
  return gates;
}

function buildVault() {
  const cx = districtCenterX(4);
  const minX = cx + 12;
  const maxX = cx + 50;
  const minZ = 60;
  const maxZ = 84;
  const h = 7;
  return {
    area: { min: [minX, 0, minZ], max: [maxX, h, maxZ] },
    walls: [
      { id: 'v-s1', ...box(minX, 0, minZ - 0.6, cx + 27, h, minZ + 0.6) },
      { id: 'v-s2', ...box(cx + 35, 0, minZ - 0.6, maxX, h, minZ + 0.6) },
      { id: 'v-n', ...box(minX, 0, maxZ - 0.6, maxX, h, maxZ + 0.6) },
      { id: 'v-w', ...box(minX - 0.6, 0, minZ, minX + 0.6, h, maxZ) },
      { id: 'v-e', ...box(maxX - 0.6, 0, minZ, maxX + 0.6, h, maxZ) },
    ],
  };
}

function buildProps(rand) {
  const palms = [];
  const lights = [];
  for (let x = WORLD.minX + 6; x < WORLD.maxX - 6; x += 11) {
    // Palms along the beach promenade.
    palms.push([x + rand() * 3, -78 - rand() * 3]);
    if (rand() < 0.5) palms.push([x + rand() * 4, -92 - rand() * 4]);
  }
  for (let x = WORLD.minX + 10; x < WORLD.maxX - 10; x += 24) {
    for (const z of AVENUES_Z) {
      lights.push([x, z - ROAD_HALF - 1]);
      lights.push([x + 12, z + ROAD_HALF + 1]);
    }
  }
  return { palms, lights };
}

// Small helper so content stays in one readable table.
function local(districtIndex, x, z, y = 0) {
  return [districtCenterX(districtIndex) + x, y, z];
}

export const STATIONS = Object.freeze([
  // Ocean Drive
  { challengeId: 'ghost-wall', pos: local(0, 14, -55), label: 'Sunset Hotel Wall Debugger' },
  { challengeId: 'broken-car', pos: local(0, 40, -55), label: 'Car Door Diagnostics' },
  { challengeId: 'invisible-gate', pos: local(0, 82, -14.5), label: 'Downtown Gate Controller' },
  // Downtown
  { challengeId: 'broken-mission', pos: local(1, -30, -55), label: 'Courier Dispatch Terminal' },
  { challengeId: 'teleporting-npc', pos: local(1, -48, -40), label: 'Pedestrian Routing Box' },
  { challengeId: 'frozen-player', pos: local(1, -12, -40), label: 'Netcode Relay' },
  // Vice Port
  { challengeId: 'flying-car', pos: local(2, 20, -55), label: 'Vehicle Physics Rig' },
  { challengeId: 'broken-reload', pos: local(2, 44, -40), label: 'Armory Reload Bench' },
  // Neon District
  { challengeId: 'infinite-ammo', pos: local(3, -45, 10), label: 'Shooting Range Console' },
  { challengeId: 'faulty-checkpoint', pos: local(3, -30, 30), label: 'Neon Run Timing Gate' },
  { challengeId: 'double-score', pos: local(3, -15, 10), label: 'Payout Terminal' },
  // Industrial Zone
  { challengeId: 'broken-final-gate', pos: local(4, 18, 58), label: 'Final Vault Controller' },
]);

export const SPAWNS = Object.freeze([
  local(0, 30, -40), local(0, 40, -26), local(0, 46, -30), local(0, 10, -42), local(0, -30, -76), local(0, 30, -82),
  local(1, -30, -30), local(1, -50, -25), local(1, -10, -28),
  local(2, 30, -30), local(2, 15, -25), local(2, 45, -28),
  local(3, -30, 20), local(3, -45, 30), local(3, -15, 35),
  local(4, 30, 50), local(4, 0, 30), local(4, 60, 25),
]);

export const VEHICLE_SPAWNS = Object.freeze([
  { id: 'car-1', name: 'Sunrise Coupe', color: '#ff4fa3', pos: local(0, 30, -70), ry: Math.PI / 2 },
  { id: 'car-2', name: 'Pastel Cruiser', color: '#4fe3ff', pos: local(0, -20, -10), ry: Math.PI / 2 },
  { id: 'car-3', name: 'Downtown Taxi', color: '#ffd23f', pos: local(1, -30, -10), ry: Math.PI / 2 },
  { id: 'car-4', name: 'Dock Hauler', color: '#2ecc71', pos: local(2, 30, -70), ry: Math.PI / 2 },
  { id: 'car-5', name: 'Neon Racer', color: '#b84dff', pos: local(3, -30, 50), ry: Math.PI / 2 },
  { id: 'car-6', name: 'Factory Pickup', color: '#ff7a2f', pos: local(4, 30, -10), ry: Math.PI / 2 },
]);

export const MISSION_NPCS = Object.freeze([
  { id: 'npc-rico', name: 'Rico', color: '#ffcc00', pos: local(1, -40, -28) },
  { id: 'npc-vera', name: 'Vera', color: '#ff4fa3', pos: local(1, 60, 20) },
]);

export const MISSIONS = Object.freeze([
  {
    id: 'm-ocean', district: 'ocean', title: 'Welcome to Vice',
    summary: 'Walk to the end of the pier and take in the sunset.',
    steps: [{ type: 'reach', pos: local(0, 30, -112), radius: 4, label: 'End of the pier' }],
    reward: 150,
  },
  {
    id: 'm-downtown', district: 'downtown', title: 'Special Delivery',
    summary: 'Pick up a package from Rico and deliver it to Vera. The courier state machine is buggy.',
    steps: [
      { type: 'talk', npc: 'npc-rico', label: 'Pick up from Rico' },
      { type: 'talk', npc: 'npc-vera', label: 'Deliver to Vera', usesChallenge: 'broken-mission' },
    ],
    reward: 250,
  },
  {
    id: 'm-port', district: 'port', title: 'Dock Run',
    summary: 'Drive any car onto the loading dock.',
    steps: [{ type: 'reach', pos: local(2, -30, -88), radius: 6, inVehicle: true, label: 'Loading dock' }],
    reward: 250,
  },
  {
    id: 'm-neon', district: 'neon', title: 'Neon Run',
    summary: 'Hit three neon checkpoints in order. The checkpoint detector is buggy.',
    steps: [
      { type: 'checkpoint', pos: local(3, 0, 50), radius: 4, label: 'Checkpoint 1', usesChallenge: 'faulty-checkpoint' },
      { type: 'checkpoint', pos: local(3, 60, -10), radius: 4, label: 'Checkpoint 2', usesChallenge: 'faulty-checkpoint' },
      { type: 'checkpoint', pos: local(3, 0, -70), radius: 4, label: 'Checkpoint 3', usesChallenge: 'faulty-checkpoint' },
    ],
    reward: 300,
  },
  {
    id: 'm-industrial', district: 'industrial', title: 'The Vault',
    summary: 'Open the Final Vault and step inside to clear the city.',
    steps: [{ type: 'reach', pos: local(4, 31, 72), radius: 6, label: 'Inside the vault' }],
    reward: 500,
  },
]);

// Pedestrian loops (district-local coordinates around blocks).
export const PEDESTRIAN_ROUTES = Object.freeze([
  { district: 0, points: [[8, -60], [52, -60], [52, -44], [8, -44]] },
  { district: 0, points: [[-52, -78], [-8, -78], [-8, -84], [-52, -84]] },
  { district: 1, points: [[-52, -62], [-8, -62], [-8, -18], [-52, -18]] },
  { district: 1, points: [[8, -2], [52, -2], [52, 42], [8, 42]] },
  { district: 1, points: [[-52, 2], [-8, 2], [-8, 42], [-52, 42]] },
  { district: 3, points: [[-52, 2], [-8, 2], [-8, 42], [-52, 42]] },
]).map((r) => ({ district: r.district, points: r.points.map(([x, z]) => [districtCenterX(r.district) + x, z]) }));

export const PIER = Object.freeze({ min: [districtCenterX(0) + 26, 0, -116], max: [districtCenterX(0) + 34, 0.4, -82] });
export const DOCK = Object.freeze({ min: [districtCenterX(2) - 50, 0, -112], max: [districtCenterX(2) - 10, 0.4, -82] });

// The Ghost Wall: this hotel's player collision is driven by the
// ghost-wall challenge function instead of the physics engine.
export const GHOST_HOTEL = Object.freeze({
  id: 'b-ghost-hotel', district: 'ocean', kind: 'building', color: '#ff9ecf', neon: true, ghost: true,
  name: 'Sunset Hotel',
  ...box(districtCenterX(0) + 10, 0, -38, districtCenterX(0) + 24, 16, -18),
});

export function buildWorld() {
  const rand = mulberry32(19860901);
  const buildings = [];
  for (const d of DISTRICTS) buildDistrictBuildings(d, rand, buildings);
  buildings.push(GHOST_HOTEL);
  const walls = buildWalls();
  const gates = buildGates();
  const vault = buildVault();
  const props = buildProps(rand);
  // Solids used for bullets / line of sight (gates always block bullets).
  const solids = [
    ...buildings.map((b) => ({ id: b.id, min: b.min, max: b.max })),
    ...walls.filter((w) => !w.invisible).map((w) => ({ id: w.id, min: w.min, max: w.max })),
    ...vault.walls.map((w) => ({ id: w.id, min: w.min, max: w.max })),
    ...gates.map((g) => ({ id: g.id, min: g.min, max: g.max })),
  ];
  return { buildings, walls, gates, vault, props, solids };
}

let cached = null;
export function getWorld() {
  if (!cached) cached = buildWorld();
  return cached;
}

// --- Geometry helpers shared by client and server -------------------------

// Ray vs axis-aligned box (slab method). Returns distance or Infinity.
export function rayAabb(origin, dir, min, max, maxDist = Infinity) {
  let tmin = 0;
  let tmax = maxDist;
  for (let a = 0; a < 3; a++) {
    const o = origin[a];
    const d = dir[a];
    if (Math.abs(d) < 1e-9) {
      if (o < min[a] || o > max[a]) return Infinity;
      continue;
    }
    let t1 = (min[a] - o) / d;
    let t2 = (max[a] - o) / d;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

export function pointInBox(p, b, pad = 0) {
  return p[0] >= b.min[0] - pad && p[0] <= b.max[0] + pad &&
    p[1] >= b.min[1] - pad && p[1] <= b.max[1] + pad &&
    p[2] >= b.min[2] - pad && p[2] <= b.max[2] + pad;
}

export function dist2D(a, b) {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}
