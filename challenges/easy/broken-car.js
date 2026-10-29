export default {
  id: 'broken-car',
  title: 'Broken Car',
  difficulty: 'easy',
  district: 'ocean',
  mandatory: false,
  entry: 'canEnterVehicle',
  summary: 'Nobody can get into a car.',
  description:
    'Pressing E next to a car should put you in the driver seat, but canEnterVehicle() refuses every request. ' +
    'Fix the condition. Once verified, the server switches to the approved vehicle-entry rule for you and you can drive.',
  reproduce: [
    'Walk up to the pink Sunrise Coupe parked on Ocean Drive.',
    'Press E next to the driver door.',
    'The game says the door is jammed.',
  ],
  hints: [
    'You can only enter a car that has no driver.',
    'The player must be close enough: distance should be at most the range.',
  ],
  consequence: 'You can enter and drive cars with E.',
  starterCode: `// player:  { position: { x, y, z }, alive: boolean, inVehicle: boolean }
// vehicle: { position: { x, y, z }, driver: string | null }
// range:   the maximum distance (on the ground plane) from the car.
// Returns true when the player may take the driver seat.
function canEnterVehicle(player, vehicle, range) {
  const dx = player.position.x - vehicle.position.x;
  const dz = player.position.z - vehicle.position.z;
  const distance = Math.sqrt(dx * dx + dz * dz);
  return player.alive && !player.inVehicle && vehicle.driver !== null && distance > range;
}
`,
  solutionCode: `function canEnterVehicle(player, vehicle, range) {
  const dx = player.position.x - vehicle.position.x;
  const dz = player.position.z - vehicle.position.z;
  const distance = Math.sqrt(dx * dx + dz * dz);
  return player.alive && !player.inVehicle && vehicle.driver === null && distance <= range;
}
`,
  tests: [
    { name: 'standing next to an empty car', args: [{ position: { x: 1, y: 0, z: 1 }, alive: true, inVehicle: false }, { position: { x: 2, y: 0, z: 2 }, driver: null }, 4.5], expected: true },
    { name: 'car already has a driver', args: [{ position: { x: 1, y: 0, z: 1 }, alive: true, inVehicle: false }, { position: { x: 2, y: 0, z: 2 }, driver: 'p2' }, 4.5], expected: false },
    { name: 'too far away', args: [{ position: { x: 20, y: 0, z: 0 }, alive: true, inVehicle: false }, { position: { x: 0, y: 0, z: 0 }, driver: null }, 4.5], expected: false },
    { name: 'exactly at the range limit', args: [{ position: { x: 3, y: 0, z: 4 }, alive: true, inVehicle: false }, { position: { x: 0, y: 0, z: 0 }, driver: null }, 5], expected: true },
    { name: 'height difference is ignored', args: [{ position: { x: 1, y: 2, z: 0 }, alive: true, inVehicle: false }, { position: { x: 0, y: 0, z: 0 }, driver: null }, 4.5], expected: true },
    { name: 'dead players cannot enter', args: [{ position: { x: 1, y: 0, z: 0 }, alive: false, inVehicle: false }, { position: { x: 0, y: 0, z: 0 }, driver: null }, 4.5], expected: false },
    { name: 'already driving another car', args: [{ position: { x: 1, y: 0, z: 0 }, alive: true, inVehicle: true }, { position: { x: 0, y: 0, z: 0 }, driver: null }, 4.5], expected: false },
    { name: 'entry check A', hidden: true, args: [{ position: { x: -10, y: 0, z: -12 }, alive: true, inVehicle: false }, { position: { x: -12, y: 0, z: -10 }, driver: null }, 3], expected: true },
    { name: 'entry check B', hidden: true, args: [{ position: { x: -10, y: 0, z: -12 }, alive: true, inVehicle: false }, { position: { x: -13, y: 0, z: -9 }, driver: null }, 3], expected: false },
  ],
};
