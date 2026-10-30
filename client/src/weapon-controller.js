// Weapons on the page: input, aiming, and effects. The game engine
// (engine/session.js) decides cooldown, ammo, reloads and what each shot hits;
// this controller asks it to fire and draws the result.
import * as THREE from 'three';
import { WEAPONS, PLAYER } from '../../shared/config.js';
import { input } from './input.js';
import { sfx } from './audio.js';

const ORDER = Object.keys(WEAPONS);

export class WeaponController {
  constructor({ camera, camCtl, physics, session, hud, effects }) {
    this.camera = camera;
    this.cam = camCtl;
    this.physics = physics;
    this.session = session;
    this.hud = hud;
    this.fx = effects;
    this.ray = new THREE.Ray();
    this.tmp = new THREE.Vector3();
    this.onHit = () => {};
    this.refresh();
  }

  get equipped() {
    return this.session.player.equipped;
  }

  get owned() {
    return this.session.player.progress.weapons;
  }

  ammoOf(id) {
    return this.session.weapons.view(this.session.player, id);
  }

  refresh() {
    this.hud.setWeapon(this.equipped, this.ammoOf(this.equipped), this.owned);
  }

  equip(id) {
    if (!this.owned.includes(id)) {
      this.hud.toast(`${WEAPONS[id].name} is locked. Fix its bug challenge to unlock it.`, 'warn');
      return;
    }
    this.session.equip(id);
    sfx.click();
    this.refresh();
  }

  reload() {
    const r = this.session.reload(this.equipped);
    if (r.ok) sfx.reload();
    this.refresh();
  }

  /** Where the crosshair points: camera ray against the world and the bots as drawn. */
  aimPoint(boxes) {
    const origin = this.camera.position.clone();
    const dir = this.cam.forward();
    const range = WEAPONS[this.equipped].range + 10;
    let best = this.physics.castRay({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z }, range);
    this.ray.set(origin, dir);
    for (const b of boxes) {
      const hit = this.ray.intersectBox(b, this.tmp);
      if (hit) {
        const d = hit.distanceTo(origin);
        if (d < best) best = d;
      }
    }
    if (!Number.isFinite(best)) best = range;
    return origin.addScaledVector(dir, best);
  }

  update(dt, { playerPos, canFire, boxes }) {
    for (let i = 1; i <= 4; i++) if (input.consume(`Digit${i}`)) this.equip(ORDER[i - 1]);
    if (input.consume('KeyR')) this.reload();
    const w = WEAPONS[this.equipped];
    const wantFire = w.auto ? input.fireDown : input.firePressed;
    if (wantFire && canFire) this.tryFire(playerPos, boxes, input.firePressed);
  }

  tryFire(playerPos, boxes, freshPress = true) {
    const eye = new THREE.Vector3(playerPos.x, playerPos.y + PLAYER.eyeHeight, playerPos.z);
    const target = this.aimPoint(boxes);
    const dir = target.clone().sub(eye).normalize();
    const r = this.session.fire({ weapon: this.equipped, dir: [dir.x, dir.y, dir.z] });
    if (!r.ok) {
      if (r.reason === 'empty') {
        if (freshPress) sfx.empty();
        this.reload();
      } else if (r.reason === 'debugging' && freshPress) {
        this.hud.toast('Weapons are holstered while your safe-debugging shield is up.', 'warn');
      }
      return false;
    }
    const muzzle = eye.clone().addScaledVector(dir, 0.8);
    this.fx.muzzle(muzzle);
    for (const end of r.tracers) this.fx.tracer(muzzle, this.tmp.set(end[0], end[1], end[2]));
    sfx.shot(this.equipped);
    this.cam.pitch += 0.012 * (this.equipped === 'shotgun' || this.equipped === 'rifle' ? 3 : 1);
    if (r.hits.length) {
      const killed = r.hits.some((h) => h.killed);
      this.hud.hitMarker(killed);
      if (killed) sfx.kill();
      else sfx.hit();
      for (const h of r.hits) this.onHit(h);
    }
    if (r.ammo.ammo === 0 && r.ammo.reserve > 0) this.reload();
    this.refresh();
    return true;
  }
}
