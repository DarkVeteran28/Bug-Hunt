export default {
  id: 'frozen-player',
  title: 'Frozen Bots',
  difficulty: 'medium',
  district: 'downtown',
  mandatory: false,
  entry: 'interpolateRemote',
  summary: 'Glitch bots stutter and freeze instead of moving smoothly.',
  description:
    'Glitch bots are drawn by interpolating between position reports from the city tracking relay (10 reports a second). The helper below only ever returns the older snapshot, and when snapshots run late it shows the oldest one. ' +
    'Fix interpolateRemote(). Your verified version then draws every glitch bot in your game.',
  reproduce: [
    'Find a red glitch bot patrolling a street (there are two in Ocean Beach).',
    'Watch it move: it jumps in steps and sometimes freezes in place.',
  ],
  hints: [
    'Math.floor(alpha) is 0 for every alpha below 1, so lerp never leaves a.',
    'When renderTime is newer than every snapshot, show the newest snapshot, not the oldest.',
  ],
  consequence: 'Glitch bots move smoothly on your screen, drawn by your function.',
  starterCode: `// buffer:     array of snapshots { t, x, y, z }, sorted by t (milliseconds), oldest first
// renderTime: the time (ms) we want to draw the player at
// Returns { x, y, z } for that time, or null when the buffer is empty.
// Before the first snapshot use the first one. After the last snapshot use the last one.
function lerp(a, b, alpha) {
  return a + (b - a) * Math.floor(alpha);
}

function interpolateRemote(buffer, renderTime) {
  if (buffer.length === 0) return null;
  const first = buffer[0];
  if (renderTime <= first.t) return { x: first.x, y: first.y, z: first.z };
  for (let i = 0; i < buffer.length - 1; i++) {
    const a = buffer[i];
    const b = buffer[i + 1];
    if (renderTime >= a.t && renderTime <= b.t) {
      const alpha = (renderTime - a.t) / (b.t - a.t);
      return { x: lerp(a.x, b.x, alpha), y: lerp(a.y, b.y, alpha), z: lerp(a.z, b.z, alpha) };
    }
  }
  return { x: first.x, y: first.y, z: first.z };
}
`,
  solutionCode: `function lerp(a, b, alpha) {
  return a + (b - a) * alpha;
}
function interpolateRemote(buffer, renderTime) {
  if (buffer.length === 0) return null;
  const first = buffer[0];
  if (renderTime <= first.t) return { x: first.x, y: first.y, z: first.z };
  for (let i = 0; i < buffer.length - 1; i++) {
    const a = buffer[i];
    const b = buffer[i + 1];
    if (renderTime >= a.t && renderTime <= b.t) {
      const alpha = b.t === a.t ? 1 : (renderTime - a.t) / (b.t - a.t);
      return { x: lerp(a.x, b.x, alpha), y: lerp(a.y, b.y, alpha), z: lerp(a.z, b.z, alpha) };
    }
  }
  const last = buffer[buffer.length - 1];
  return { x: last.x, y: last.y, z: last.z };
}
`,
  tests: [
    { name: 'empty buffer returns null', args: [[], 100], expected: null },
    { name: 'halfway between two snapshots', args: [[{ t: 0, x: 0, y: 0, z: 0 }, { t: 100, x: 10, y: 2, z: -4 }], 50], expected: { x: 5, y: 1, z: -2 } },
    { name: 'a quarter of the way through the second segment', args: [[{ t: 0, x: 0, y: 0, z: 0 }, { t: 100, x: 10, y: 0, z: 0 }, { t: 200, x: 10, y: 0, z: 20 }], 125], expected: { x: 10, y: 0, z: 5 } },
    { name: 'before the first snapshot uses the first', args: [[{ t: 50, x: 1, y: 2, z: 3 }, { t: 100, x: 9, y: 9, z: 9 }], 10], expected: { x: 1, y: 2, z: 3 } },
    { name: 'late snapshots hold the newest position, not the oldest', args: [[{ t: 0, x: 0, y: 0, z: 0 }, { t: 100, x: 10, y: 0, z: 0 }, { t: 200, x: 20, y: 0, z: 0 }], 260], expected: { x: 20, y: 0, z: 0 } },
    { name: 'interpolation check A', hidden: true, args: [[{ t: 1000, x: -4, y: 0, z: 8 }, { t: 1040, x: 4, y: 1, z: 0 }], 1030], expected: { x: 2, y: 0.75, z: 2 } },
    { name: 'interpolation check B', hidden: true, args: [[{ t: 10, x: 3, y: 0, z: 3 }], 50], expected: { x: 3, y: 0, z: 3 } },
  ],
};
