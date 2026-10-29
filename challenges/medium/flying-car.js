export default {
  id: 'flying-car',
  title: 'Flying Car',
  difficulty: 'medium',
  district: 'port',
  mandatory: true,
  entry: 'stepVehicle',
  summary: 'Port vehicles float into the sky.',
  description:
    'Vehicles in Vice Port run on an experimental physics rig, stepVehicle(). Gravity is applied in the wrong direction, so cars drift upward and never report being on the ground. ' +
    'Fix the vertical physics. Verifying this is the mandatory Vice Port challenge and unlocks the Neon District.',
  reproduce: [
    'Get into the green Dock Hauler parked on the Vice Port beach road.',
    'Drive forward: the car slowly lifts off and keeps climbing until the game resets it.',
  ],
  hints: [
    'GRAVITY is already negative. Adding it to the velocity pulls the car down.',
    'When the car reaches the ground it should stop falling and report grounded: true.',
  ],
  consequence: 'Unlocks the Neon District, and Port vehicles drive on the ground using your physics.',
  starterCode: `// state: { position: { x, y, z }, velocityY: number, heading: number, speed: number, grounded: boolean }
// input: { throttle: -1..1, steer: -1..1 }
// dt:    seconds
// The ground is at y = 0. Returns a NEW state.
function stepVehicle(state, input, dt) {
  const GRAVITY = -20;
  const ACCEL = 16;
  const MAX_SPEED = 26;
  const TURN_RATE = 1.6;
  const FRICTION = 4;

  let speed = state.speed + input.throttle * ACCEL * dt;
  if (input.throttle === 0) {
    const slow = Math.min(Math.abs(speed), FRICTION * dt);
    speed -= Math.sign(speed) * slow;
  }
  speed = Math.max(-MAX_SPEED / 2, Math.min(MAX_SPEED, speed));
  const heading = state.heading + input.steer * TURN_RATE * dt * (speed / MAX_SPEED);

  let velocityY = state.velocityY - GRAVITY * dt;
  let y = state.position.y + velocityY * dt;
  let grounded = false;
  if (y < 0) {
    y = 0;
    velocityY = 0;
  }

  return {
    position: {
      x: state.position.x + Math.sin(heading) * speed * dt,
      y,
      z: state.position.z + Math.cos(heading) * speed * dt,
    },
    velocityY,
    heading,
    speed,
    grounded,
  };
}
`,
  solutionCode: `function stepVehicle(state, input, dt) {
  const GRAVITY = -20;
  const ACCEL = 16;
  const MAX_SPEED = 26;
  const TURN_RATE = 1.6;
  const FRICTION = 4;
  let speed = state.speed + input.throttle * ACCEL * dt;
  if (input.throttle === 0) {
    const slow = Math.min(Math.abs(speed), FRICTION * dt);
    speed -= Math.sign(speed) * slow;
  }
  speed = Math.max(-MAX_SPEED / 2, Math.min(MAX_SPEED, speed));
  const heading = state.heading + input.steer * TURN_RATE * dt * (speed / MAX_SPEED);
  let velocityY = state.velocityY + GRAVITY * dt;
  let y = state.position.y + velocityY * dt;
  let grounded = false;
  if (y <= 0) {
    y = 0;
    velocityY = 0;
    grounded = true;
  }
  return {
    position: { x: state.position.x + Math.sin(heading) * speed * dt, y, z: state.position.z + Math.cos(heading) * speed * dt },
    velocityY, heading, speed, grounded,
  };
}
`,
  tests: [
    { name: 'a parked car stays on the ground', args: [{ position: { x: 0, y: 0, z: 0 }, velocityY: 0, heading: 0, speed: 0, grounded: true }, { throttle: 0, steer: 0 }, 0.1], expected: { position: { x: 0, y: 0, z: 0 }, velocityY: 0, heading: 0, speed: 0, grounded: true } },
    { name: 'driving forward stays on the ground', args: [{ position: { x: 0, y: 0, z: 0 }, velocityY: 0, heading: 0, speed: 10, grounded: true }, { throttle: 1, steer: 0 }, 0.1], expected: { position: { x: 0, y: 0, z: 1.16 }, velocityY: 0, heading: 0, speed: 11.6, grounded: true } },
    { name: 'an airborne car falls', args: [{ position: { x: 0, y: 5, z: 0 }, velocityY: 0, heading: 0, speed: 0, grounded: false }, { throttle: 0, steer: 0 }, 0.1], expected: { position: { x: 0, y: 4.8, z: 0 }, velocityY: -2, heading: 0, speed: 0, grounded: false } },
    { name: 'a falling car lands', args: [{ position: { x: 0, y: 0.1, z: 0 }, velocityY: -5, heading: 0, speed: 0, grounded: false }, { throttle: 0, steer: 0 }, 0.1], expected: { position: { x: 0, y: 0, z: 0 }, velocityY: 0, heading: 0, speed: 0, grounded: true } },
    { name: 'speed is capped', args: [{ position: { x: 0, y: 0, z: 0 }, velocityY: 0, heading: 0, speed: 26, grounded: true }, { throttle: 1, steer: 0 }, 0.5], expected: { position: { x: 0, y: 0, z: 13 }, velocityY: 0, heading: 0, speed: 26, grounded: true } },
    { name: 'physics check A', hidden: true, args: [{ position: { x: 0, y: 2, z: 0 }, velocityY: 3, heading: 0, speed: 0, grounded: false }, { throttle: 0, steer: 0 }, 0.05], expected: { position: { x: 0, y: 2.1, z: 0 }, velocityY: 2, heading: 0, speed: 0, grounded: false } },
  ],
};
