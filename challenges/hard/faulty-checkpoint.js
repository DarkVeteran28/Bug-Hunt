export default {
  id: 'faulty-checkpoint',
  title: 'Faulty Checkpoint',
  difficulty: 'hard',
  district: 'neon',
  mandatory: false,
  entry: 'isInsideCheckpoint',
  unlocksWeapon: 'rifle',
  summary: 'Neon Run checkpoints never trigger.',
  description:
    'The Neon Run mission asks you to pass through three glowing checkpoint rings, but isInsideCheckpoint() never reports a hit. ' +
    'Fix the cylinder test. The game then uses the approved checkpoint rule for your Neon Run, and you unlock the Rifle.',
  reproduce: [
    'Start the Neon Run by walking into the first magenta checkpoint ring at the crossroads north of the Neon plaza.',
    'Stand in the middle of the ring.',
    'Nothing happens.',
  ],
  hints: [
    'A vertical cylinder ignores height when measuring distance: use only x and z. Check each coordinate carefully.',
    'Compare squared distance with radius * radius. The height range is center.y to center.y + height, edges included.',
  ],
  consequence: 'Neon Run checkpoints work for you and the Rifle (slot 4) unlocks.',
  starterCode: `// pos:        { x, y, z }
// checkpoint: { center: { x, y, z }, radius: number, height: number }
// A checkpoint is a vertical cylinder standing on center, from center.y
// up to center.y + height. Points on the edge count as inside.
function isInsideCheckpoint(pos, checkpoint) {
  const dx = pos.x - checkpoint.center.x;
  const dy = pos.y - checkpoint.center.y;
  const dz = pos.z - checkpoint.center.x;
  const distSq = dx * dx + dy * dy + dz * dz;
  return distSq < checkpoint.radius && pos.y >= checkpoint.center.y && pos.y <= checkpoint.height;
}
`,
  solutionCode: `function isInsideCheckpoint(pos, checkpoint) {
  const dx = pos.x - checkpoint.center.x;
  const dz = pos.z - checkpoint.center.z;
  const distSq = dx * dx + dz * dz;
  const r = checkpoint.radius;
  return distSq <= r * r && pos.y >= checkpoint.center.y && pos.y <= checkpoint.center.y + checkpoint.height;
}
`,
  tests: [
    { name: 'standing in the middle of the ring', args: [{ x: 540, y: 0.9, z: 50 }, { center: { x: 540, y: 0, z: 50 }, radius: 4, height: 6 }], expected: true },
    { name: 'near the edge of the ring', args: [{ x: 543, y: 1, z: 51 }, { center: { x: 540, y: 0, z: 50 }, radius: 4, height: 6 }], expected: true },
    { name: 'exactly on the edge counts', args: [{ x: 544, y: 0, z: 50 }, { center: { x: 540, y: 0, z: 50 }, radius: 4, height: 6 }], expected: true },
    { name: 'outside the radius', args: [{ x: 545, y: 1, z: 50 }, { center: { x: 540, y: 0, z: 50 }, radius: 4, height: 6 }], expected: false },
    { name: 'jumping high inside the ring still counts', args: [{ x: 540, y: 5.5, z: 50 }, { center: { x: 540, y: 0, z: 50 }, radius: 4, height: 6 }], expected: true },
    { name: 'above the ring does not count', args: [{ x: 540, y: 7, z: 50 }, { center: { x: 540, y: 0, z: 50 }, radius: 4, height: 6 }], expected: false },
    { name: 'raised checkpoint uses its own base height', args: [{ x: 10, y: 12, z: 10 }, { center: { x: 10, y: 8, z: 10 }, radius: 3, height: 6 }], expected: true },
    { name: 'ring check A', hidden: true, args: [{ x: -2, y: 3, z: 1.5 }, { center: { x: 0, y: 2, z: 0 }, radius: 2.5, height: 1 }], expected: true },
    { name: 'ring check B', hidden: true, args: [{ x: 0, y: 1.9, z: 0 }, { center: { x: 0, y: 2, z: 0 }, radius: 2.5, height: 1 }], expected: false },
  ],
};
