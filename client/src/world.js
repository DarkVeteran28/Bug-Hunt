// Builds the visible city from the shared world data: merged building
// geometry, instanced props, gates, debugging stations and mission markers.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  getWorld, WORLD, DISTRICTS, DISTRICT_WIDTH, AVENUES_Z, CROSS_LOCAL_X, ROAD_HALF, STATIONS,
  districtCenterX, PIER, DOCK, MISSIONS, MISSION_NPCS, GHOST_HOTEL,
} from '../../shared/world-data.js';

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function windowTextures() {
  // One tile = 4x4 world units with a single window. Texel (0,0) is wall.
  const seedLit = [];
  for (let i = 0; i < 64; i++) seedLit.push(Math.random());
  const map = canvasTexture(64, 64, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#5b6b8c';
    g.fillRect(14, 12, 36, 34);
    g.fillStyle = '#e8e0f0';
    g.fillRect(14, 28, 36, 2);
  });
  const emissive = canvasTexture(64, 64, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#ffcf7a';
    g.fillRect(16, 14, 32, 30);
  });
  return { map, emissive };
}

/** Box geometry with per-face UVs scaled to world size (one window per 4 units). */
function buildingBox(b, color, windows = true) {
  const w = b.max[0] - b.min[0];
  const h = b.max[1] - b.min[1];
  const d = b.max[2] - b.min[2];
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
  const uv = g.attributes.uv;
  const faceScale = [[d, h], [d, h], [0, 0], [0, 0], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = windows ? faceScale[f] : [0, 0];
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * (su / 4), uv.getY(i) * (sv / 4) + (sv ? 0.15 : 0));
    }
  }
  const c = new THREE.Color(color);
  const colors = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < g.attributes.position.count; i++) {
    // Roofs a little darker.
    const roof = i >= 8 && i < 12;
    colors[i * 3] = c.r * (roof ? 0.6 : 1);
    colors[i * 3 + 1] = c.g * (roof ? 0.6 : 1);
    colors[i * 3 + 2] = c.b * (roof ? 0.6 : 1);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function plainBox(min, max, color) {
  return buildingBox({ min, max }, color, false);
}

function labelSprite(text, { color = '#ffffff', bg = 'rgba(10,4,20,0.75)', size = 1, border = null } = {}) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = 'bold 36px Trebuchet MS, sans-serif';
  const w = Math.ceil(g.measureText(text).width) + 28;
  c.width = w;
  c.height = 56;
  g.font = 'bold 36px Trebuchet MS, sans-serif';
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(0, 0, w, 56, 12);
  g.fill();
  if (border) {
    g.strokeStyle = border;
    g.lineWidth = 3;
    g.stroke();
  }
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, 14, 30);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true }));
  s.scale.set((w / 56) * 0.6 * size, 0.6 * size, 1);
  s.userData.canvas = c;
  return s;
}
export { labelSprite };

function neonSign(text, color) {
  const tex = canvasTexture(512, 128, (g, w, h) => {
    g.fillStyle = 'rgba(0,0,0,0)';
    g.clearRect(0, 0, w, h);
    g.font = 'bold italic 84px Trebuchet MS, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = color;
    g.shadowBlur = 24;
    g.fillStyle = color;
    g.fillText(text, w / 2, h / 2 + 4);
    g.shadowBlur = 0;
    g.fillStyle = '#ffffff';
    g.globalAlpha = 0.6;
    g.fillText(text, w / 2, h / 2 + 4);
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false }));
  return m;
}

export function buildWorld(scene, { shadows = false } = {}) {
  const world = getWorld();
  const root = new THREE.Group();
  scene.add(root);

  // --- Ground, sand and roads -------------------------------------------
  const width = WORLD.maxX - WORLD.minX;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(width, WORLD.maxZ - WORLD.beachZ), new THREE.MeshStandardMaterial({ color: '#3b3346', roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((WORLD.minX + WORLD.maxX) / 2, 0, (WORLD.maxZ + WORLD.beachZ) / 2);
  ground.receiveShadow = shadows;
  root.add(ground);
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(width, WORLD.beachZ - WORLD.waterZ + 8), new THREE.MeshStandardMaterial({ color: '#f4d29c', roughness: 1 }));
  sand.rotation.x = -Math.PI / 2;
  sand.position.set((WORLD.minX + WORLD.maxX) / 2, -0.01, (WORLD.beachZ + WORLD.waterZ) / 2 - 3);
  sand.receiveShadow = shadows;
  root.add(sand);
  // Sand slope into the water.
  const shore = new THREE.Mesh(new THREE.PlaneGeometry(width, 6), new THREE.MeshStandardMaterial({ color: '#d9b27a' }));
  shore.rotation.x = -Math.PI / 2 - 0.35;
  shore.position.set((WORLD.minX + WORLD.maxX) / 2, -0.9, WORLD.waterZ - 2.6);
  root.add(shore);

  const roadMat = new THREE.MeshStandardMaterial({ color: '#24202c', roughness: 0.9 });
  const roadGeos = [];
  const sidewalkGeos = [];
  for (const z of AVENUES_Z) {
    const g = new THREE.PlaneGeometry(width, ROAD_HALF * 2);
    g.rotateX(-Math.PI / 2);
    g.translate((WORLD.minX + WORLD.maxX) / 2, 0.02, z);
    roadGeos.push(g);
    for (const s of [-1, 1]) {
      const sw = new THREE.BoxGeometry(width, 0.12, 2.4);
      sw.translate((WORLD.minX + WORLD.maxX) / 2, 0.06, z + s * (ROAD_HALF + 1.2));
      sidewalkGeos.push(sw);
    }
  }
  for (const d of DISTRICTS) {
    for (const lx of CROSS_LOCAL_X) {
      const x = districtCenterX(d.index) + lx;
      const g = new THREE.PlaneGeometry(ROAD_HALF * 2, WORLD.maxZ - WORLD.beachZ);
      g.rotateX(-Math.PI / 2);
      g.translate(x, 0.025, (WORLD.maxZ + WORLD.beachZ) / 2);
      roadGeos.push(g);
    }
  }
  const roads = new THREE.Mesh(mergeGeometries(roadGeos), roadMat);
  roads.receiveShadow = shadows;
  root.add(roads);
  const sidewalks = new THREE.Mesh(mergeGeometries(sidewalkGeos), new THREE.MeshStandardMaterial({ color: '#8d8296' }));
  sidewalks.receiveShadow = shadows;
  root.add(sidewalks);

  // Dashed lane markings (instanced).
  const dashGeo = new THREE.PlaneGeometry(3, 0.25);
  dashGeo.rotateX(-Math.PI / 2);
  const dashes = [];
  for (const z of AVENUES_Z) for (let x = WORLD.minX + 2; x < WORLD.maxX; x += 7) dashes.push([x, z, 0]);
  for (const d of DISTRICTS) for (const lx of CROSS_LOCAL_X) for (let z = WORLD.beachZ + 2; z < WORLD.maxZ; z += 7) {
    if (AVENUES_Z.some((az) => Math.abs(az - z) < ROAD_HALF + 1)) continue;
    dashes.push([districtCenterX(d.index) + lx, z, Math.PI / 2]);
  }
  const dashMesh = new THREE.InstancedMesh(dashGeo, new THREE.MeshBasicMaterial({ color: '#ffe9a8' }), dashes.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  dashes.forEach(([x, z, r], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r);
    m4.compose(new THREE.Vector3(x, 0.04, z), q, one);
    dashMesh.setMatrixAt(i, m4);
  });
  root.add(dashMesh);

  // --- Buildings --------------------------------------------------------
  const tex = windowTextures();
  const buildingGeos = [];
  const plainGeos = [];
  const neonGeos = [];
  const neonColors = ['#ff4fa3', '#4fe3ff', '#b84dff', '#ffd23f'];
  let n = 0;
  for (const b of world.buildings) {
    if (b.ghost) continue;
    if (b.kind === 'container') {
      plainGeos.push(plainBox(b.min, b.max, b.color));
      continue;
    }
    buildingGeos.push(buildingBox(b, b.color, true));
    if (b.neon) {
      const c = neonColors[n++ % neonColors.length];
      const y = b.max[1] + 0.05;
      const t = 0.25;
      neonGeos.push(plainBox([b.min[0] - t, y - 0.4, b.min[2] - t], [b.max[0] + t, y, b.min[2] + t], c));
      neonGeos.push(plainBox([b.min[0] - t, y - 0.4, b.max[2] - t], [b.max[0] + t, y, b.max[2] + t], c));
      neonGeos.push(plainBox([b.min[0] - t, y - 0.4, b.min[2]], [b.min[0] + t, y, b.max[2]], c));
      neonGeos.push(plainBox([b.max[0] - t, y - 0.4, b.min[2]], [b.max[0] + t, y, b.max[2]], c));
    }
    if (b.kind === 'factory' && (b.min[0] * 7) % 3 < 1.5) {
      const cg = new THREE.CylinderGeometry(0.9, 1.2, 10, 8);
      cg.translate(b.min[0] + 3, b.max[1] + 5, b.min[2] + 3);
      const cols = new Float32Array(cg.attributes.position.count * 3).fill(0.45);
      cg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      cg.deleteAttribute('uv');
      const uvs = new Float32Array(cg.attributes.position.count * 2);
      cg.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      plainGeos.push(cg);
    }
  }
  const buildingMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex.map, emissiveMap: tex.emissive, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.25, roughness: 0.8 });
  const buildings = new THREE.Mesh(mergeGeometries(buildingGeos), buildingMat);
  buildings.castShadow = shadows;
  buildings.receiveShadow = shadows;
  root.add(buildings);
  const plain = new THREE.Mesh(mergeGeometries(plainGeos), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.2 }));
  plain.castShadow = shadows;
  plain.receiveShadow = shadows;
  root.add(plain);
  if (neonGeos.length) {
    root.add(new THREE.Mesh(mergeGeometries(neonGeos), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false })));
  }

  // The Sunset Hotel (Ghost Wall). Looks solid; whether it IS solid depends
  // on the ghost-wall challenge function.
  const hotel = new THREE.Mesh(buildingBox(GHOST_HOTEL, GHOST_HOTEL.color, true), buildingMat);
  hotel.castShadow = shadows;
  hotel.receiveShadow = shadows;
  root.add(hotel);
  const hotelSign = neonSign('SUNSET HOTEL', '#ff4fa3');
  hotelSign.position.set((GHOST_HOTEL.min[0] + GHOST_HOTEL.max[0]) / 2, 12, GHOST_HOTEL.min[2] - 0.15);
  hotelSign.rotation.y = Math.PI;
  root.add(hotelSign);

  // Neon signs on facades in the Neon District and a few elsewhere.
  const signWords = ['NULL CLUB', 'BUG BAR', '404 LOUNGE', 'SEGFAULT', 'NaN NIGHTS', 'STACK', 'ASYNC', 'UNDEFINED', 'CALLBACK', 'HOISTED'];
  let si = 0;
  for (const b of world.buildings) {
    if (b.district !== 'neon' && !(b.district === 'ocean' && b.neon)) continue;
    if (b.kind !== 'building' || si > 26) continue;
    const s = neonSign(signWords[si % signWords.length], neonColors[si % neonColors.length]);
    s.position.set((b.min[0] + b.max[0]) / 2, Math.min(b.max[1] - 2, 7 + (si % 3) * 2), b.min[2] - 0.12);
    s.rotation.y = Math.PI;
    root.add(s);
    si++;
  }

  // --- Walls, vault, gates ----------------------------------------------
  const wallGeos = world.walls.filter((w) => !w.invisible).map((w) => plainBox(w.min, w.max, '#b9a7c9'));
  for (const w of world.vault.walls) wallGeos.push(plainBox(w.min, w.max, '#6c7a89'));
  const walls = new THREE.Mesh(mergeGeometries(wallGeos), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  walls.castShadow = shadows;
  walls.receiveShadow = shadows;
  root.add(walls);
  // Neon strip along district barriers.
  for (const w of world.walls) {
    if (!w.id.startsWith('w-b')) continue;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(w.max[0] - w.min[0] + 0.1, 0.2, w.max[2] - w.min[2]), new THREE.MeshBasicMaterial({ color: '#4fe3ff', fog: false }));
    strip.position.set((w.min[0] + w.max[0]) / 2, w.max[1] + 0.1, (w.min[2] + w.max[2]) / 2);
    root.add(strip);
  }

  const gates = new Map();
  for (const g of world.gates) {
    const group = new THREE.Group();
    const w = g.max[0] - g.min[0];
    const h = g.max[1] - g.min[1];
    const d = g.max[2] - g.min[2];
    const door = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: '#2b1a3f', emissive: '#ff2f6d', emissiveIntensity: 0.35, metalness: 0.6, roughness: 0.4 }));
    // Stripes on the door.
    const stripes = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.3, d + 0.04), new THREE.MeshBasicMaterial({ color: '#ffd23f' }));
    stripes.position.y = 0.8;
    const stripes2 = stripes.clone();
    stripes2.position.y = -0.8;
    door.add(stripes, stripes2);
    door.position.set((g.min[0] + g.max[0]) / 2, (g.min[1] + g.max[1]) / 2, (g.min[2] + g.max[2]) / 2);
    door.castShadow = shadows;
    group.add(door);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.4, 0.4), new THREE.MeshStandardMaterial({ color: '#1e1033', emissive: '#ff4f5e', emissiveIntensity: 1 }));
    panel.position.set(g.panel[0], 0.7, g.panel[2]);
    group.add(panel);
    const label = labelSprite(g.name.toUpperCase(), { color: '#ffd23f', size: 1.4, border: '#ff4fa3' });
    label.position.set(door.position.x, h + 1.4, door.position.z);
    group.add(label);
    root.add(group);
    gates.set(g.id, { data: g, door, panel, baseY: door.position.y, height: h });
  }

  // --- Pier and dock ----------------------------------------------------
  const woodMat = new THREE.MeshStandardMaterial({ color: '#8a5a3b', roughness: 0.9 });
  for (const p of [PIER, DOCK]) {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(p.max[0] - p.min[0], 0.3, p.max[2] - p.min[2]), woodMat);
    deck.position.set((p.min[0] + p.max[0]) / 2, -0.12, (p.min[2] + p.max[2]) / 2);
    deck.receiveShadow = shadows;
    root.add(deck);
    for (let z = p.min[2] + 1; z < WORLD.waterZ; z += 4) {
      for (const x of [p.min[0] + 0.4, p.max[0] - 0.4]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 3), woodMat);
        post.position.set(x, -1.6, z);
        root.add(post);
      }
    }
  }

  // --- Palms and streetlights (instanced) --------------------------------
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 7, 6);
  trunkGeo.translate(0, 3.5, 0);
  const leafGeos = [];
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.BoxGeometry(0.5, 0.08, 3.2);
    leaf.translate(0, 0, 1.6);
    leaf.rotateX(0.35);
    leaf.rotateY((i / 6) * Math.PI * 2);
    leaf.translate(0, 7, 0);
    leafGeos.push(leaf);
  }
  const crownGeo = mergeGeometries(leafGeos);
  const palms = world.props.palms;
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: '#8b6b4a' }), palms.length);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: '#2fae63' }), palms.length);
  palms.forEach(([x, z], i) => {
    q.setFromEuler(new THREE.Euler(0.06 * Math.sin(i), (i * 1.7) % 6.28, 0.06 * Math.cos(i)));
    const s = 0.85 + ((i * 37) % 10) / 30;
    m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s, s));
    trunks.setMatrixAt(i, m4);
    crowns.setMatrixAt(i, m4);
  });
  trunks.castShadow = crowns.castShadow = shadows;
  root.add(trunks, crowns);

  const lights = world.props.lights;
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 5, 5);
  poleGeo.translate(0, 2.5, 0);
  const lampGeo = new THREE.BoxGeometry(0.5, 0.2, 0.9);
  lampGeo.translate(0, 5, 0);
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: '#333' }), lights.length);
  const lamps = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: '#ffe3a3' }), lights.length);
  lights.forEach(([x, z], i) => {
    m4.makeTranslation(x, 0, z);
    poles.setMatrixAt(i, m4);
    lamps.setMatrixAt(i, m4);
  });
  root.add(poles, lamps);

  // --- Debugging stations -------------------------------------------------
  const stations = new Map();
  for (const st of STATIONS) {
    const g = new THREE.Group();
    g.position.set(st.pos[0], 0, st.pos[2]);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 0.7), new THREE.MeshStandardMaterial({ color: '#1e1033', metalness: 0.5 }));
    base.position.y = 0.6;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.6), new THREE.MeshBasicMaterial({ color: '#ffd23f' }));
    screen.position.set(0, 1.0, 0.36);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.06, 8, 32), new THREE.MeshBasicMaterial({ color: '#ffd23f', fog: false }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 2.4;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.5 }));
    beam.position.y = 1.2;
    const bug = labelSprite('🐞', { bg: 'rgba(0,0,0,0)', size: 1.3 });
    bug.position.y = 2.4;
    const label = labelSprite(st.label, { color: '#ffd23f', size: 0.8 });
    label.position.y = 3.3;
    g.add(base, screen, ring, beam, bug, label);
    root.add(g);
    stations.set(st.challengeId, { group: g, screen, ring, beam, label, data: st });
  }

  // --- Mission NPCs (static) and checkpoint rings ------------------------
  const ringMeshes = [];
  for (const m of MISSIONS) {
    m.steps.forEach((s, i) => {
      if (s.type !== 'checkpoint') return;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(s.radius, 0.25, 8, 40), new THREE.MeshBasicMaterial({ color: '#ff4fa3', fog: false, transparent: true, opacity: 0.9 }));
      ring.position.set(s.pos[0], s.radius + 0.3, s.pos[2]);
      root.add(ring);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(s.radius, s.radius, 6, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#ff4fa3', transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
      col.position.set(s.pos[0], 3, s.pos[2]);
      root.add(col);
      ringMeshes.push({ missionId: m.id, step: i, ring, col });
    });
  }

  // Mission target beacon.
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 60, 16, 1, true), new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, fog: false }));
  beacon.visible = false;
  root.add(beacon);

  // District signs at each gate.
  for (const d of DISTRICTS) {
    const sign = labelSprite(d.name.toUpperCase(), { color: '#4fe3ff', size: 2.2, bg: 'rgba(20,6,40,0.6)' });
    sign.position.set(districtCenterX(d.index) - DISTRICT_WIDTH / 2 + 8, 9, -10);
    root.add(sign);
  }

  // Beach umbrellas.
  for (let i = 0; i < 40; i++) {
    const x = WORLD.minX + 10 + i * 22 + (i % 3) * 3;
    const z = -86 - (i % 4) * 2.5;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4), new THREE.MeshStandardMaterial({ color: '#eee' }));
    pole.position.set(x, 1.2, z);
    const top = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.6, 8), new THREE.MeshStandardMaterial({ color: neonColors[i % 4] }));
    top.position.set(x, 2.5, z);
    root.add(pole, top);
  }

  let t = 0;
  function update(dt) {
    t += dt;
    for (const s of stations.values()) {
      s.ring.rotation.z += dt * 1.5;
      s.ring.position.y = 2.4 + Math.sin(t * 2 + s.group.position.x) * 0.1;
    }
    for (const r of ringMeshes) r.ring.rotation.y += dt * 0.8;
    if (beacon.visible) beacon.material.opacity = 0.14 + Math.sin(t * 3) * 0.05;
    buildingMat.emissiveIntensity = scene.userData.night ? 1.0 : 0.3;
  }

  function setStationState(id, state) {
    const s = stations.get(id);
    if (!s) return;
    const color = state === 'solved' ? '#4dff9a' : state === 'locked' ? '#666677' : '#ffd23f';
    s.screen.material.color.set(color);
    s.ring.material.color.set(color);
    s.beam.material.color.set(color);
  }

  return { root, gates, stations, ringMeshes, beacon, update, setStationState, missionNpcs: MISSION_NPCS };
}
