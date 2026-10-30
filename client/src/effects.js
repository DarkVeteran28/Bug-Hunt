// Pooled shot effects: tracer lines and impact sparks. A fixed number of each
// is created up front and recycled, so firing never allocates GPU buffers.
import * as THREE from 'three';

export class EffectPool {
  constructor(scene, { tracers = 64, impacts = 48 } = {}) {
    this.tracers = [];
    this.impacts = [];
    for (let i = 0; i < tracers; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#fff3b0', transparent: true, opacity: 0 }));
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.tracers.push({ obj: line, life: 0, max: 0.08 });
    }
    const impactGeo = new THREE.SphereGeometry(0.12, 6, 4);
    const impactMat = new THREE.MeshBasicMaterial({ color: '#ffd23f' });
    for (let i = 0; i < impacts; i++) {
      const m = new THREE.Mesh(impactGeo, impactMat);
      m.visible = false;
      scene.add(m);
      this.impacts.push({ obj: m, life: 0 });
    }
    this.ti = 0;
    this.ii = 0;
    this.flash = new THREE.PointLight('#ffcf7a', 0, 8);
    scene.add(this.flash);
  }

  tracer(from, to, color = '#fff3b0', life = 0.08) {
    const t = this.tracers[this.ti];
    this.ti = (this.ti + 1) % this.tracers.length;
    const a = t.obj.geometry.attributes.position.array;
    a[0] = from.x; a[1] = from.y; a[2] = from.z;
    a[3] = to.x; a[4] = to.y; a[5] = to.z;
    t.obj.geometry.attributes.position.needsUpdate = true;
    t.obj.material.color.set(color);
    t.obj.material.opacity = 0.9;
    t.obj.visible = true;
    t.life = life;
    t.max = life;
    const im = this.impacts[this.ii];
    this.ii = (this.ii + 1) % this.impacts.length;
    im.obj.position.copy(to);
    im.obj.visible = true;
    im.life = 0.15;
  }

  muzzle(pos) {
    this.flash.position.copy(pos);
    this.flash.intensity = 6;
  }

  update(dt) {
    for (const t of this.tracers) {
      if (!t.obj.visible) continue;
      t.life -= dt;
      t.obj.material.opacity = Math.max(0, t.life / t.max);
      if (t.life <= 0) t.obj.visible = false;
    }
    for (const im of this.impacts) {
      if (!im.obj.visible) continue;
      im.life -= dt;
      if (im.life <= 0) im.obj.visible = false;
    }
    this.flash.intensity = Math.max(0, this.flash.intensity - dt * 120);
  }
}
