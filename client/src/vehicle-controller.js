// Vehicles: meshes, parked positions and driving.
// Most cars use the built-in arcade model. The Vice Port "Dock Hauler" runs
// on the flying-car challenge function, so its bug is visible until fixed.
import * as THREE from 'three';
import { VEHICLE_SPAWNS } from '../../shared/world-data.js';
import { VEHICLE } from '../../shared/config.js';
import { input } from './input.js';
import { call } from './challenge-runtime.js';
import { sfx } from './audio.js';
import { resolveGhostHotel } from './player-controller.js';
import { labelSprite } from './world.js';

export const CHALLENGE_CAR = 'car-4';

function builtinStep(state, inp, dt) {
  const ACCEL = 16;
  const BRAKE = 30;
  const FRICTION = 5;
  const MAX = VEHICLE.maxSpeed;
  let speed = state.speed;
  if (inp.brake) speed -= Math.sign(speed) * Math.min(Math.abs(speed), BRAKE * dt);
  else if (inp.throttle) speed += inp.throttle * ACCEL * dt * (Math.sign(inp.throttle) !== Math.sign(speed) && speed !== 0 ? 1.8 : 1);
  else speed -= Math.sign(speed) * Math.min(Math.abs(speed), FRICTION * dt);
  speed = Math.max(-MAX / 2, Math.min(MAX, speed));
  const heading = state.heading + inp.steer * 1.8 * dt * Math.max(-1, Math.min(1, speed / 8));
  return {
    position: { x: state.position.x + Math.sin(heading) * speed * dt, y: 0, z: state.position.z + Math.cos(heading) * speed * dt },
    velocityY: 0,
    heading,
    speed,
    grounded: true,
  };
}

function buildCarMesh(color, shadows) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: '#15121c', roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: '#1d2b4a', metalness: 0.9, roughness: 0.1 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 4.2), paint);
  body.position.y = 0.6;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.3, 1.0), paint);
  nose.position.set(0, 0.95, 1.4);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 1.8), glass);
  cabin.position.set(0, 1.12, -0.35);
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.4), dark);
  spoiler.position.set(0, 1.2, -2.0);
  for (const m of [body, nose, cabin, spoiler]) {
    m.castShadow = shadows;
    g.add(m);
  }
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const [x, z] of [[-0.95, 1.35], [0.95, 1.35], [-0.95, -1.35], [0.95, -1.35]]) {
    const w = new THREE.Mesh(wheelGeo, dark);
    w.position.set(x, 0.38, z);
    g.add(w);
    wheels.push(w);
  }
  const lightMat = new THREE.MeshBasicMaterial({ color: '#fff6cc' });
  const tailMat = new THREE.MeshBasicMaterial({ color: '#ff2050' });
  for (const x of [-0.65, 0.65]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 0.05), lightMat);
    hl.position.set(x, 0.7, 2.11);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.05), tailMat);
    tl.position.set(x, 0.7, -2.11);
    g.add(hl, tl);
  }
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 4.4), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.05;
  g.add(glow);
  return { group: g, wheels };
}

export class VehicleController {
  constructor(scene, physics, { shadows }) {
    this.physics = physics;
    this.vehicles = VEHICLE_SPAWNS.map((spec, index) => {
      const mesh = buildCarMesh(spec.color, shadows);
      mesh.group.position.set(...spec.pos);
      mesh.group.rotation.y = spec.ry;
      const label = labelSprite(spec.id === CHALLENGE_CAR ? `${spec.name} (experimental physics)` : spec.name, { color: spec.color, size: 0.7 });
      label.position.y = 2.4;
      mesh.group.add(label);
      scene.add(mesh.group);
      return {
        id: spec.id, index, spec, mesh,
        pos: new THREE.Vector3(...spec.pos), ry: spec.ry,
        target: new THREE.Vector3(...spec.pos), targetRy: spec.ry,
      };
    });
    this.byId = new Map(this.vehicles.map((v) => [v.id, v]));
    this.driving = null; // { v, state }
    this.onReset = () => {};
  }

  /** Parked positions for a save file: [[x, y, z, ry], ...]. */
  poses() {
    return this.vehicles.map((v) => [v.pos.x, Math.max(0, v.pos.y), v.pos.z, v.ry]);
  }

  /** Put the cars back where a save left them. */
  setPoses(list) {
    if (!Array.isArray(list)) return;
    list.forEach((p, i) => {
      const v = this.vehicles[i];
      if (!v || !Array.isArray(p) || p.length !== 4 || !p.every(Number.isFinite)) return;
      v.pos.set(p[0], p[1], p[2]);
      v.target.copy(v.pos);
      v.ry = v.targetRy = p[3];
    });
  }

  nearest(pos, range = VEHICLE.enterRange) {
    let best = null;
    let bestD = range;
    for (const v of this.vehicles) {
      const d = Math.hypot(v.pos.x - pos.x, v.pos.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  startDriving(id) {
    const v = this.byId.get(id);
    if (!v) return;
    this.driving = { v, state: { position: { x: v.pos.x, y: Math.max(0, v.pos.y), z: v.pos.z }, velocityY: 0, heading: v.ry, speed: 0, grounded: true } };
    this.physics.setPlayerEnabled(false);
    this.physics.setCar(true, v.pos.x, Math.max(0, v.pos.y), v.pos.z);
    sfx.setEngine(true, 0);
  }

  stopDriving() {
    if (!this.driving) return null;
    const v = this.driving.v;
    this.driving = null;
    this.physics.setCar(false);
    this.physics.setPlayerEnabled(true);
    sfx.setEngine(false);
    return v;
  }

  resetCar(v) {
    v.pos.set(...v.spec.pos);
    v.ry = v.spec.ry;
    if (this.driving && this.driving.v === v) {
      this.driving.state = { position: { x: v.pos.x, y: 0, z: v.pos.z }, velocityY: 0, heading: v.ry, speed: 0, grounded: true };
      this.physics.setCar(true, v.pos.x, 0, v.pos.z);
    }
  }

  /** Drive the car for one frame. Returns the car pose. */
  drive(dt) {
    const d = this.driving;
    if (!d) return null;
    const inp = {
      throttle: (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0),
      steer: (input.down('KeyA') ? 1 : 0) - (input.down('KeyD') ? 1 : 0),
      brake: input.down('Space'),
    };
    const prev = d.state;
    let next;
    if (d.v.id === CHALLENGE_CAR) {
      const fallback = { ...prev, speed: 0 };
      next = call('flying-car', [prev, { throttle: inp.brake ? 0 : inp.throttle, steer: inp.steer }, dt], fallback);
      if (!next || !next.position || ![next.position.x, next.position.y, next.position.z, next.heading, next.speed].every(Number.isFinite)) next = fallback;
    } else {
      next = builtinStep(prev, inp, dt);
    }
    const desired = { x: next.position.x - prev.position.x, y: next.position.y - prev.position.y, z: next.position.z - prev.position.z };
    const res = this.physics.moveCar(desired);
    let pos = res.pos;
    const wanted = Math.hypot(desired.x, desired.z);
    const got = Math.hypot(res.moved.x, res.moved.z);
    if (wanted > 0.05 && got < wanted * 0.5) next = { ...next, speed: next.speed * 0.3 }; // bumped into something
    const fixed = resolveGhostHotel(pos, 1.2, 1.6);
    if (fixed) {
      this.physics.setCar(true, fixed.x, fixed.y, fixed.z);
      pos = fixed;
      next = { ...next, speed: next.speed * 0.3 };
    }
    d.state = { ...next, position: { x: pos.x, y: pos.y, z: pos.z } };
    d.v.pos.set(pos.x, pos.y, pos.z);
    d.v.ry = next.heading;
    d.v.target.copy(d.v.pos);
    d.v.targetRy = next.heading;
    sfx.setEngine(true, next.speed);
    if (pos.y > 24) {
      this.onReset(d.v, 'The Dock Hauler floated away (Flying Car bug). Resetting it to its parking spot.');
      this.resetCar(d.v);
    }
    return { x: d.v.pos.x, y: d.v.pos.y, z: d.v.pos.z, ry: d.v.ry, speed: next.speed };
  }

  update(dt) {
    for (const v of this.vehicles) {
      const mine = this.driving && this.driving.v === v;
      if (!mine) {
        v.pos.lerp(v.target, 1 - Math.exp(-dt * 10));
        let dr = v.targetRy - v.ry;
        while (dr > Math.PI) dr -= Math.PI * 2;
        while (dr < -Math.PI) dr += Math.PI * 2;
        v.ry += dr * Math.min(1, dt * 10);
      }
      v.mesh.group.position.copy(v.pos);
      v.mesh.group.rotation.y = v.ry;
      const speed = mine ? this.driving.state.speed : 0;
      for (const w of v.mesh.wheels) w.rotation.x += speed * dt * 2.6;
      this.physics.setVehicleObstacle(v.index, v.pos.x, v.pos.y, v.pos.z, v.ry, !mine);
    }
  }
}
