// Local third-person character: camera-relative movement, sprint, jump,
// gravity and collisions through Rapier. The Sunset Hotel's walls are
// checked with the ghost-wall challenge function instead of the physics
// engine, so fixing that challenge is what makes the hotel solid.
import * as THREE from 'three';
import { PLAYER } from '/shared/config.js';
import { GHOST_HOTEL } from '/shared/world-data.js';
import { input } from './input.js';
import { call } from './challenge-runtime.js';
import { sfx } from './audio.js';

const hotelBox = {
  min: { x: GHOST_HOTEL.min[0], y: GHOST_HOTEL.min[1], z: GHOST_HOTEL.min[2] },
  max: { x: GHOST_HOTEL.max[0], y: GHOST_HOTEL.max[1], z: GHOST_HOTEL.max[2] },
};

/** Push a box of half-size r out of the hotel if the ghost-wall rule says they overlap. */
export function resolveGhostHotel(pos, r, height) {
  const box = {
    min: { x: pos.x - r, y: pos.y, z: pos.z - r },
    max: { x: pos.x + r, y: pos.y + height, z: pos.z + r },
  };
  const overlap = call('ghost-wall', [box, hotelBox], false) === true;
  if (!overlap) return null;
  const pushXNeg = box.max.x - hotelBox.min.x;
  const pushXPos = hotelBox.max.x - box.min.x;
  const pushZNeg = box.max.z - hotelBox.min.z;
  const pushZPos = hotelBox.max.z - box.min.z;
  const m = Math.min(pushXNeg, pushXPos, pushZNeg, pushZPos);
  if (m <= 0 || m > 30) return null;
  const out = { x: pos.x, y: pos.y, z: pos.z };
  if (m === pushXNeg) out.x -= pushXNeg + 0.01;
  else if (m === pushXPos) out.x += pushXPos + 0.01;
  else if (m === pushZNeg) out.z -= pushZNeg + 0.01;
  else out.z += pushZPos + 0.01;
  return out;
}

export class PlayerController {
  constructor(physics, camCtl, avatar) {
    this.physics = physics;
    this.cam = camCtl;
    this.avatar = avatar;
    this.vy = 0;
    this.grounded = false;
    this.ry = 0;
    this.anim = 'idle';
    this.speed = 0;
    this.stepTimer = 0;
    this.enabled = true;
    this.inHotel = false;
  }

  get position() {
    return this.physics.playerPosition();
  }

  teleport(p) {
    this.physics.teleportPlayer(p[0], p[1], p[2]);
    this.vy = 0;
  }

  update(dt, { frozen = false } = {}) {
    const { f, r } = this.cam.flatAxes();
    const move = new THREE.Vector3();
    if (!frozen && this.enabled) {
      if (input.down('KeyW')) move.add(f);
      if (input.down('KeyS')) move.sub(f);
      if (input.down('KeyD')) move.add(r);
      if (input.down('KeyA')) move.sub(r);
    }
    const moving = move.lengthSq() > 0;
    if (moving) move.normalize();
    const sprint = input.down('ShiftLeft') || input.down('ShiftRight');
    const speed = moving ? (sprint && !this.cam.aiming ? PLAYER.sprintSpeed : PLAYER.walkSpeed) : 0;
    this.speed = speed;

    if (this.grounded && !frozen && input.consume('Space')) {
      this.vy = PLAYER.jumpVelocity;
      this.grounded = false;
    }
    this.vy -= PLAYER.gravity * dt;
    if (this.vy < -40) this.vy = -40;

    const desired = { x: move.x * speed * dt, y: this.vy * dt, z: move.z * speed * dt };
    const res = this.physics.movePlayer(desired);
    this.grounded = res.grounded;
    if (this.grounded && this.vy < 0) this.vy = 0;
    // Hit a ceiling.
    if (this.vy > 0 && res.moved.y < desired.y * 0.5) this.vy = 0;

    const fixed = resolveGhostHotel(res.pos, PLAYER.radius, PLAYER.height);
    if (fixed) this.physics.teleportPlayer(fixed.x, fixed.y, fixed.z);
    const p = this.position;
    this.inHotel = p.x > GHOST_HOTEL.min[0] && p.x < GHOST_HOTEL.max[0] && p.z > GHOST_HOTEL.min[2] && p.z < GHOST_HOTEL.max[2];

    // Face the aim direction when aiming, otherwise the movement direction.
    if (this.cam.aiming) this.ry = Math.atan2(f.x, f.z);
    else if (moving) {
      const target = Math.atan2(move.x, move.z);
      let d = target - this.ry;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.ry += d * Math.min(1, dt * 12);
    }

    this.anim = !this.grounded ? 'jump' : !moving ? 'idle' : speed > PLAYER.walkSpeed ? 'run' : 'walk';
    if (this.grounded && moving) {
      this.stepTimer -= dt * (speed / PLAYER.walkSpeed);
      if (this.stepTimer <= 0) {
        this.stepTimer = 0.42;
        sfx.footstep();
      }
    }
    return p;
  }
}
