// Rapier physics: static city colliders, toggleable gates, kinematic
// character / car controllers and camera ray casts.
import RAPIER from '@dimforge/rapier3d-compat';
import { getWorld, WORLD, PIER, DOCK, VEHICLE_SPAWNS } from '/shared/world-data.js';
import { PLAYER } from '/shared/config.js';

export async function createPhysics() {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const data = getWorld();

  const fixedBox = (min, max) => {
    const hx = (max[0] - min[0]) / 2;
    const hy = (max[1] - min[1]) / 2;
    const hz = (max[2] - min[2]) / 2;
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(min[0] + hx, min[1] + hy, min[2] + hz);
    return world.createCollider(desc);
  };

  // Ground slab (top at y = 0) from the north wall to the waterline.
  fixedBox([WORLD.minX - 2, -2, WORLD.waterZ], [WORLD.maxX + 2, 0, WORLD.maxZ + 2]);
  // Pier and dock decks reach out over the water.
  fixedBox([PIER.min[0], -2, PIER.min[2]], [PIER.max[0], 0.03, PIER.max[2]]);
  fixedBox([DOCK.min[0], -2, DOCK.min[2]], [DOCK.max[0], 0.03, DOCK.max[2]]);
  for (const b of data.buildings) if (!b.ghost) fixedBox(b.min, b.max);
  for (const w of data.walls) fixedBox(w.min, [w.max[0], w.max[1] + 20, w.max[2]]);
  for (const w of data.vault.walls) fixedBox(w.min, w.max);
  const gates = new Map();
  for (const g of data.gates) gates.set(g.id, fixedBox(g.min, g.max));

  // Player capsule on a kinematic body.
  const halfHeight = (PLAYER.height - PLAYER.radius * 2) / 2;
  const playerBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 5, 0));
  const playerCollider = world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight, PLAYER.radius).setTranslation(0, halfHeight + PLAYER.radius, 0), playerBody);
  const controller = world.createCharacterController(0.05);
  controller.enableAutostep(0.45, 0.2, true);
  controller.enableSnapToGround(0.4);
  controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
  controller.setApplyImpulsesToDynamicBodies(false);

  // Car body used while driving (a ball keeps it from snagging on corners).
  const carBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -50, 0));
  const carCollider = world.createCollider(RAPIER.ColliderDesc.ball(1.25).setTranslation(0, 1.25, 0), carBody);
  carCollider.setEnabled(false);
  const carController = world.createCharacterController(0.05);
  carController.enableAutostep(0.4, 0.5, false);
  carController.setApplyImpulsesToDynamicBodies(false);

  // Parked / remote vehicles as solid obstacles.
  const vehicleColliders = VEHICLE_SPAWNS.map((v) => {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(v.pos[0], 0, v.pos[2]));
    const col = world.createCollider(RAPIER.ColliderDesc.cuboid(1.0, 0.75, 2.1).setTranslation(0, 0.75, 0), body);
    return { body, col };
  });

  function moveCharacter(collider, ctrl, body, desired) {
    ctrl.computeColliderMovement(collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    const m = ctrl.computedMovement();
    const p = body.translation();
    const next = { x: p.x + m.x, y: p.y + m.y, z: p.z + m.z };
    body.setNextKinematicTranslation(next);
    body.setTranslation(next, true);
    return { pos: next, grounded: ctrl.computedGrounded(), moved: m };
  }

  return {
    RAPIER,
    world,
    setGateSolid(id, solid) {
      const c = gates.get(id);
      if (c && c.isEnabled() !== solid) c.setEnabled(solid);
    },
    teleportPlayer(x, y, z) {
      playerBody.setTranslation({ x, y, z }, true);
      playerBody.setNextKinematicTranslation({ x, y, z });
    },
    playerPosition: () => playerBody.translation(),
    movePlayer: (desired) => moveCharacter(playerCollider, controller, playerBody, desired),
    setPlayerEnabled(on) {
      playerCollider.setEnabled(on);
    },
    setCar(on, x = 0, y = -50, z = 0) {
      carCollider.setEnabled(on);
      carBody.setTranslation({ x, y, z }, true);
      carBody.setNextKinematicTranslation({ x, y, z });
    },
    moveCar: (desired) => moveCharacter(carCollider, carController, carBody, desired),
    carPosition: () => carBody.translation(),
    setVehicleObstacle(index, x, y, z, ry, enabled) {
      const v = vehicleColliders[index];
      if (!v) return;
      v.col.setEnabled(enabled);
      v.body.setNextKinematicTranslation({ x, y, z });
      const h = ry / 2;
      v.body.setNextKinematicRotation({ x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) });
    },
    /** Distance to the first static obstacle along a ray (camera collision, aiming). */
    castRay(origin, dir, maxDist) {
      const ray = new RAPIER.Ray(origin, dir);
      const hit = world.castRay(ray, maxDist, true, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
      return hit ? hit.timeOfImpact : Infinity;
    },
    step(dt) {
      world.timestep = Math.min(dt, 1 / 30);
      world.step();
    },
  };
}
