// Draws data chips, med kits and ammo crates. Every item uses one shared
// geometry and material per kind; items are only shown or hidden, never
// created or destroyed while playing.
import * as THREE from 'three';

const KIND = {
  chip: { color: '#4fe3ff', emissive: '#1aa6c4', geo: () => new THREE.OctahedronGeometry(0.45) },
  medkit: { color: '#ffffff', emissive: '#ff4f5e', geo: () => new THREE.BoxGeometry(0.8, 0.5, 0.8) },
  ammo: { color: '#ffd23f', emissive: '#7a5a00', geo: () => new THREE.BoxGeometry(0.9, 0.45, 0.6) },
};

export class PickupView {
  constructor(scene, items) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.shared = {};
    for (const [k, v] of Object.entries(KIND)) {
      this.shared[k] = { geo: v.geo(), mat: new THREE.MeshStandardMaterial({ color: v.color, emissive: v.emissive, emissiveIntensity: 0.8, roughness: 0.4 }) };
    }
    // A cross on the med kits, so they read at a distance.
    const crossMat = new THREE.MeshBasicMaterial({ color: '#ff2a3c' });
    this.crossGeo = new THREE.BoxGeometry(0.5, 0.52, 0.14);
    this.meshes = new Map();
    for (const it of items) {
      const s = this.shared[it.kind];
      const m = new THREE.Mesh(s.geo, s.mat);
      m.position.set(it.pos[0], 1, it.pos[2]);
      if (it.kind === 'medkit') {
        const a = new THREE.Mesh(this.crossGeo, crossMat);
        const b = new THREE.Mesh(this.crossGeo, crossMat);
        b.rotation.y = Math.PI / 2;
        m.add(a, b);
      }
      m.userData = { base: it.pos, phase: it.pos[0] * 0.13 + it.pos[2] * 0.07, kind: it.kind };
      this.group.add(m);
      this.meshes.set(it.id, m);
    }
    this.time = 0;
  }

  update(dt, items) {
    this.time += dt;
    for (const it of items) {
      const m = this.meshes.get(it.id);
      if (!m) continue;
      m.visible = it.visible;
      if (!it.visible) continue;
      m.rotation.y += dt * 1.6;
      m.position.y = 0.9 + Math.sin(this.time * 2.2 + m.userData.phase) * 0.15;
    }
  }

  minimapDots(items) {
    return items.filter((i) => i.visible && i.kind === 'chip').map((i) => ({ x: i.pos[0], z: i.pos[2], color: '#4fe3ff' }));
  }
}
