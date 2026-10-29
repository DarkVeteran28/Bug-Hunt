// Original low-poly blocky character with procedural limb animation.
import * as THREE from 'three';
import { labelSprite } from './world.js';

const skinTones = ['#f1c27d', '#c68642', '#8d5524', '#ffdbac', '#e0ac69'];
const WEAPON_SIZES = { pistol: [0.12, 0.18, 0.45], smg: [0.14, 0.22, 0.65], shotgun: [0.14, 0.2, 0.95], rifle: [0.12, 0.18, 1.15] };

export function createCharacter({ color = '#ff4fa3', name = null, seed = 0, shadows = true } = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const shirt = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const pants = new THREE.MeshStandardMaterial({ color: '#2b2f4a', roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: skinTones[seed % skinTones.length], roughness: 0.8 });
  const hair = new THREE.MeshStandardMaterial({ color: ['#2a1b10', '#f5d36b', '#111', '#a33'][seed % 4] });

  const box = (w, h, d, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.castShadow = shadows;
    return m;
  };

  const torso = box(0.62, 0.7, 0.34, shirt);
  torso.position.y = 1.2;
  const head = box(0.4, 0.42, 0.4, skin);
  head.position.y = 1.78;
  const hairTop = box(0.42, 0.12, 0.42, hair);
  hairTop.position.y = 0.2;
  head.add(hairTop);
  const shades = box(0.36, 0.08, 0.05, new THREE.MeshStandardMaterial({ color: '#111', metalness: 0.8, roughness: 0.2 }));
  shades.position.set(0, 0.04, 0.2);
  head.add(shades);

  const limb = (w, h, d, mat, x, y) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const m = box(w, h, d, mat);
    m.position.y = -h / 2;
    pivot.add(m);
    return pivot;
  };
  const legL = limb(0.24, 0.85, 0.26, pants, -0.16, 0.85);
  const legR = limb(0.24, 0.85, 0.26, pants, 0.16, 0.85);
  const armL = limb(0.18, 0.68, 0.2, shirt, 0.42, 1.52);
  const armR = limb(0.18, 0.68, 0.2, shirt, -0.42, 1.52);
  const hand = box(0.16, 0.16, 0.16, skin);
  hand.position.y = -0.72;
  armR.add(hand);
  const gun = box(0.12, 0.18, 0.45, new THREE.MeshStandardMaterial({ color: '#222', metalness: 0.7, roughness: 0.3 }));
  gun.position.set(0, -0.72, 0.25);
  armR.add(gun);
  body.add(torso, head, legL, legR, armL, armR);

  // Shield bubble for safe debugging and spawn protection.
  const shield = new THREE.Mesh(new THREE.SphereGeometry(1.25, 16, 12), new THREE.MeshBasicMaterial({ color: '#4fe3ff', transparent: true, opacity: 0.18, depthWrite: false }));
  shield.position.y = 1;
  shield.visible = false;
  root.add(shield);

  let tag = null;
  if (name) {
    tag = labelSprite(name, { color: '#ffffff', size: 0.8 });
    tag.position.y = 2.45;
    root.add(tag);
  }

  let phase = 0;
  let aimPitch = 0;
  let currentWeapon = 'pistol';
  return {
    root,
    tag,
    setVisible(v) {
      root.visible = v;
    },
    setShield(on, color = '#4fe3ff') {
      shield.visible = on;
      shield.material.color.set(color);
    },
    setWeapon(id) {
      if (id === currentWeapon) return;
      currentWeapon = id;
      const s = WEAPON_SIZES[id] || WEAPON_SIZES.pistol;
      gun.geometry.dispose();
      gun.geometry = new THREE.BoxGeometry(...s);
      gun.position.z = s[2] / 2 + 0.02;
    },
    setAim(pitch) {
      aimPitch = pitch;
    },
    /** anim: idle | walk | run | jump | drive | dead */
    animate(dt, anim, speed = 0) {
      body.rotation.x = 0;
      body.position.y = 0;
      if (anim === 'dead') {
        body.rotation.x = -Math.PI / 2;
        body.position.y = 0.25;
        return;
      }
      if (anim === 'walk' || anim === 'run') phase += dt * (anim === 'run' ? 11 : 7.5);
      else phase *= 0.9;
      const swing = anim === 'run' ? 0.9 : anim === 'walk' ? 0.55 : 0;
      const s = Math.sin(phase) * swing;
      legL.rotation.x = s;
      legR.rotation.x = -s;
      armL.rotation.x = -s * 0.8;
      // Right arm holds the weapon toward the aim direction.
      armR.rotation.x = -Math.PI / 2 + Math.max(-0.8, Math.min(0.8, aimPitch));
      if (anim === 'jump') {
        legL.rotation.x = 0.5;
        legR.rotation.x = -0.3;
      }
      body.position.y = anim === 'run' ? Math.abs(Math.sin(phase)) * 0.06 : 0;
      return speed;
    },
    stepPhase: () => phase,
    dispose() {
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
    },
  };
}
