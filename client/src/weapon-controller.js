// Client side of combat: input, predicted ammo/cooldown for instant feedback,
// aim ray, and visual/audio effects. The server validates every shot and
// sends back the authoritative ammo and damage results.
import * as THREE from 'three';
import { WEAPONS, PLAYER } from '/shared/config.js';
import { input } from './input.js';
import { sfx } from './audio.js';

const ORDER = Object.keys(WEAPONS);

export class WeaponController {
  constructor({ scene, camera, camCtl, physics, net, hud }) {
    this.scene = scene;
    this.camera = camera;
    this.cam = camCtl;
    this.physics = physics;
    this.net = net;
    this.hud = hud;
    this.equipped = 'pistol';
    this.owned = ['pistol'];
    this.ammo = Object.fromEntries(ORDER.map((w) => [w, { ammo: WEAPONS[w].magSize, reserve: WEAPONS[w].reserve, reloading: false, reloadUntil: 0 }]));
    this.lastShot = 0;
    this.effects = [];
    this.flash = new THREE.PointLight('#ffcf7a', 0, 8);
    scene.add(this.flash);
    this.tracerMat = new THREE.LineBasicMaterial({ color: '#fff3b0', transparent: true, opacity: 0.9 });
    this.impactGeo = new THREE.SphereGeometry(0.12, 6, 4);
    this.impactMat = new THREE.MeshBasicMaterial({ color: '#ffd23f' });
  }

  setOwned(list) {
    this.owned = list;
    if (!list.includes(this.equipped)) this.equip('pistol');
    this.hud.setWeapon(this.equipped, this.ammo[this.equipped], this.owned);
  }

  setAmmo(view) {
    if (!view || !this.ammo[view.weapon]) return;
    const a = this.ammo[view.weapon];
    a.ammo = view.ammo;
    a.reserve = view.reserve;
    a.reloading = view.reloading;
    a.reloadUntil = view.reloading ? performance.now() + Math.max(0, view.reloadUntil - this.net.serverNow()) : 0;
    this.hud.setWeapon(this.equipped, this.ammo[this.equipped], this.owned);
  }

  equip(id) {
    if (!this.owned.includes(id)) {
      this.hud.toast(`${WEAPONS[id].name} is locked. Fix its bug challenge to unlock it.`, 'warn');
      return;
    }
    this.equipped = id;
    this.net.emit('equip', { weapon: id });
    this.hud.setWeapon(id, this.ammo[id], this.owned);
  }

  reload() {
    const a = this.ammo[this.equipped];
    const w = WEAPONS[this.equipped];
    if (a.reloading || a.ammo >= w.magSize || a.reserve <= 0) return;
    a.reloading = true;
    a.reloadUntil = performance.now() + w.reloadMs;
    this.net.emit('reload', { weapon: this.equipped });
    sfx.reload();
    this.hud.setWeapon(this.equipped, a, this.owned);
  }

  /** Where the crosshair points: camera ray against the world and remote players. */
  aimPoint(remoteBoxes) {
    const origin = this.camera.position.clone();
    const dir = this.cam.forward();
    const range = WEAPONS[this.equipped].range + 10;
    let best = this.physics.castRay({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z }, range);
    const ray = new THREE.Ray(origin, dir);
    const tmp = new THREE.Vector3();
    for (const b of remoteBoxes) {
      const hit = ray.intersectBox(b, tmp);
      if (hit) {
        const d = hit.distanceTo(origin);
        if (d < best) best = d;
      }
    }
    if (!Number.isFinite(best)) best = range;
    return origin.addScaledVector(dir, best);
  }

  update(dt, { playerPos, canFire, remoteBoxes }) {
    const now = performance.now();
    for (const [k, a] of Object.entries(this.ammo)) {
      if (a.reloading && now >= a.reloadUntil) {
        // The server's ammo update is authoritative; this only predicts it.
        const w = WEAPONS[k];
        const take = Math.min(w.magSize - a.ammo, a.reserve);
        a.ammo += take;
        a.reserve -= take;
        a.reloading = false;
        if (k === this.equipped) this.hud.setWeapon(k, a, this.owned);
      }
    }
    for (let i = 1; i <= 4; i++) if (input.consume(`Digit${i}`)) this.equip(ORDER[i - 1]);
    if (input.consume('KeyR')) this.reload();

    const w = WEAPONS[this.equipped];
    const wantFire = w.auto ? input.fireDown : input.firePressed;
    if (wantFire && canFire) this.tryFire(playerPos, remoteBoxes, input.firePressed);

    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life -= dt;
      if (e.obj.material && e.obj.material.opacity !== undefined && e.fade) e.obj.material.opacity = Math.max(0, e.life / e.max);
      if (e.life <= 0) {
        this.scene.remove(e.obj);
        if (e.dispose) e.obj.geometry.dispose();
        this.effects.splice(i, 1);
      }
    }
    this.flash.intensity = Math.max(0, this.flash.intensity - dt * 120);
  }

  /** Fire the equipped weapon once if the local cooldown and ammo allow it. */
  tryFire(playerPos, remoteBoxes, freshPress = true) {
    const now = performance.now();
    const w = WEAPONS[this.equipped];
    if (now - this.lastShot < w.fireIntervalMs) return false;
    const a = this.ammo[this.equipped];
    if (a.reloading) return false;
    if (a.ammo <= 0) {
      if (freshPress) sfx.empty();
      if (a.reserve > 0) this.reload();
      return false;
    }
    this.lastShot = now;
    a.ammo -= 1;
    const eye = new THREE.Vector3(playerPos.x, playerPos.y + PLAYER.eyeHeight, playerPos.z);
    const target = this.aimPoint(remoteBoxes);
    const dir = target.clone().sub(eye).normalize();
    this.net.emit('fire', { weapon: this.equipped, dir: [dir.x, dir.y, dir.z] });
    this.muzzle(eye.clone().addScaledVector(dir, 0.8));
    this.tracer(eye.clone().addScaledVector(dir, 0.8), [target]);
    sfx.shot(this.equipped);
    this.cam.pitch += 0.012 * (this.equipped === 'shotgun' || this.equipped === 'rifle' ? 3 : 1);
    this.hud.setWeapon(this.equipped, a, this.owned);
    return true;
  }

  muzzle(pos) {
    this.flash.position.copy(pos);
    this.flash.intensity = 6;
  }

  tracer(from, ends) {
    for (const end of ends) {
      const geo = new THREE.BufferGeometry().setFromPoints([from, end]);
      const line = new THREE.Line(geo, this.tracerMat.clone());
      this.scene.add(line);
      this.effects.push({ obj: line, life: 0.08, max: 0.08, fade: true, dispose: true });
      const imp = new THREE.Mesh(this.impactGeo, this.impactMat);
      imp.position.copy(end);
      this.scene.add(imp);
      this.effects.push({ obj: imp, life: 0.15, max: 0.15 });
    }
  }

  /** Effects for a shot reported by the server (other players). */
  remoteShot(shot, listenerPos) {
    const from = new THREE.Vector3(...shot.o);
    this.tracer(from, shot.e.map((e) => new THREE.Vector3(...e)));
    this.muzzle(from);
    sfx.shot(shot.weapon, listenerPos.distanceTo(from));
  }
}
