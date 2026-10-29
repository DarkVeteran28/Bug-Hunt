export default {
  id: 'ghost-wall',
  title: 'Ghost Wall',
  difficulty: 'easy',
  district: 'ocean',
  mandatory: false,
  entry: 'aabbOverlap',
  summary: 'Players walk straight through the Sunset Hotel.',
  description:
    'The pink Sunset Hotel on the Ocean Drive plaza uses aabbOverlap() to decide whether your body is touching its walls. ' +
    'Right now you can walk straight through it. Fix the overlap test so the hotel becomes solid.',
  reproduce: [
    'Walk up to the pink Sunset Hotel next to the plaza.',
    'Keep walking into its wall.',
    'You pass through the building instead of being stopped.',
  ],
  hints: [
    'Two boxes overlap when they overlap on every axis at the same time.',
    'On one axis, intervals [a1, a2] and [b1, b2] overlap when a1 < b2 and a2 > b1. Touching edges do not count.',
  ],
  consequence: 'The Sunset Hotel becomes solid for you: the game now runs your aabbOverlap() for its walls.',
  starterCode: `// Returns true when two axis-aligned boxes overlap.
// Boxes look like { min: { x, y, z }, max: { x, y, z } }.
// Boxes that only touch at an edge or face do NOT overlap.
function aabbOverlap(a, b) {
  return (
    a.min.x <= b.min.x && a.max.x >= b.max.x &&
    a.min.y <= b.min.y && a.max.y >= b.max.y &&
    a.min.z <= b.min.z && a.max.z >= b.max.z
  );
}
`,
  solutionCode: `function aabbOverlap(a, b) {
  return (
    a.min.x < b.max.x && a.max.x > b.min.x &&
    a.min.y < b.max.y && a.max.y > b.min.y &&
    a.min.z < b.max.z && a.max.z > b.min.z
  );
}
`,
  tests: [
    { name: 'small player box inside a big wall overlaps', args: [{ min: { x: 1, y: 0, z: 1 }, max: { x: 1.8, y: 1.8, z: 1.8 } }, { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 16, z: 10 } }], expected: true },
    { name: 'player pressing into a wall face overlaps', args: [{ min: { x: -0.5, y: 0, z: 2 }, max: { x: 0.3, y: 1.8, z: 2.8 } }, { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 16, z: 10 } }], expected: true },
    { name: 'separated boxes do not overlap', args: [{ min: { x: 11, y: 0, z: 0 }, max: { x: 12, y: 2, z: 1 } }, { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 16, z: 10 } }], expected: false },
    { name: 'touching faces do not overlap', args: [{ min: { x: 10, y: 0, z: 0 }, max: { x: 11, y: 2, z: 1 } }, { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 16, z: 10 } }], expected: false },
    { name: 'overlap on x and z but player is on the roof', args: [{ min: { x: 2, y: 17, z: 2 }, max: { x: 3, y: 19, z: 3 } }, { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 16, z: 10 } }], expected: false },
    { name: 'order of arguments does not matter', args: [{ min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 16, z: 10 } }, { min: { x: 9.5, y: 0, z: 4 }, max: { x: 10.3, y: 1.8, z: 4.8 } }], expected: true },
    { name: 'overlap check A', hidden: true, args: [{ min: { x: -3, y: 1, z: -3 }, max: { x: -1, y: 2, z: -1 } }, { min: { x: -2, y: 0, z: -2 }, max: { x: 5, y: 4, z: 5 } }], expected: true },
    { name: 'overlap check B', hidden: true, args: [{ min: { x: -3, y: 0, z: 7 }, max: { x: -1, y: 2, z: 9 } }, { min: { x: -2, y: 0, z: -2 }, max: { x: 5, y: 4, z: 5 } }], expected: false },
  ],
};
