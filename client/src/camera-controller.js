// Over-the-shoulder third-person camera with smoothing and collision.
import * as THREE from 'three';
import { settings } from './settings.js';

export class CameraController {
  constructor(camera, physics) {
    this.camera = camera;
    this.physics = physics;
    this.yaw = Math.PI; // looking north (+z) into the city
    this.pitch = -0.15;
    this.distance = 5.6;
    this.current = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.aiming = false;
    this.initialised = false;
  }

  look(dx, dy) {
    const s = 0.0025 * settings.sensitivity * (this.aiming ? 0.55 : 1);
    this.yaw -= dx * s;
    this.pitch -= dy * s * (settings.invertY ? -1 : 1);
    this.pitch = Math.max(-1.2, Math.min(0.9, this.pitch));
  }

  /** Unit vector the camera looks along (used for aiming). */
  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  /** Flat forward/right vectors for camera-relative movement. */
  flatAxes() {
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const r = new THREE.Vector3(-f.z, 0, f.x);
    return { f, r };
  }

  update(dt, focus, { inVehicle = false } = {}) {
    const dist = inVehicle ? 9 : this.aiming ? 2.8 : this.distance;
    const shoulder = inVehicle ? 0 : this.aiming ? 0.75 : 0.55;
    const height = inVehicle ? 2.8 : 1.85;
    const fwd = this.forward();
    const { r } = this.flatAxes();
    const pivot = new THREE.Vector3(focus.x, focus.y + height, focus.z).addScaledVector(r, shoulder);
    const desired = pivot.clone().addScaledVector(fwd, -dist);
    // Pull the camera in if a wall is between it and the player.
    const dir = desired.clone().sub(pivot);
    const len = dir.length();
    dir.normalize();
    const hit = this.physics.castRay({ x: pivot.x, y: pivot.y, z: pivot.z }, { x: dir.x, y: dir.y, z: dir.z }, len);
    if (hit < len) desired.copy(pivot).addScaledVector(dir, Math.max(0.3, hit - 0.25));
    if (desired.y < 0.3) desired.y = 0.3;
    if (!this.initialised) {
      this.current.copy(desired);
      this.initialised = true;
    }
    const k = 1 - Math.exp(-dt * 18);
    this.current.lerp(desired, k);
    this.camera.position.copy(this.current);
    this.target.copy(pivot).addScaledVector(fwd, 20);
    this.camera.lookAt(this.target);
    const fov = this.aiming ? 50 : inVehicle ? 75 : 70;
    if (Math.abs(this.camera.fov - fov) > 0.1) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 10);
      this.camera.updateProjectionMatrix();
    }
  }
}
