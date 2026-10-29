export default {
  id: 'teleporting-npc',
  title: 'Teleporting NPC',
  difficulty: 'medium',
  district: 'downtown',
  mandatory: false,
  entry: 'stepNpc',
  summary: 'Pedestrians jump around instead of walking.',
  description:
    'City pedestrians follow looping waypoint routes using stepNpc(). They currently leap across the street and snap back to the start of their route. ' +
    'Fix the movement and the waypoint advance. Your verified function then drives every pedestrian you see.',
  reproduce: [
    'Watch the pedestrians walking around the Downtown plaza or the Ocean Drive plaza.',
    'They take huge jumps and sometimes snap back to the start of their route.',
  ],
  hints: [
    'Moving by dx * step only works when (dx, dz) has length 1. Normalise the direction first.',
    'Operator precedence: a + 1 % n is a + (1 % n). You want (a + 1) % n.',
  ],
  consequence: 'Pedestrians walk smoothly around their routes using your code.',
  starterCode: `// npc:       { position: { x, z }, index: number, speed: number }
// waypoints: array of { x, z } that forms a loop
// dt:        seconds
// Moves the NPC toward waypoints[index] at npc.speed units per second.
// If it would reach the waypoint this step, it stops exactly on it and
// targets the next waypoint (looping back to 0 after the last one).
// Returns a NEW npc object.
function stepNpc(npc, waypoints, dt) {
  const target = waypoints[npc.index];
  const dx = target.x - npc.position.x;
  const dz = target.z - npc.position.z;
  const dist = Math.hypot(dx, dz);
  const step = npc.speed * dt;
  if (dist <= step) {
    return {
      position: { x: target.x, z: target.z },
      index: npc.index + 1 % waypoints.length,
      speed: npc.speed,
    };
  }
  return {
    position: { x: npc.position.x + dx * step, z: npc.position.z + dz * step },
    index: npc.index,
    speed: npc.speed,
  };
}
`,
  solutionCode: `function stepNpc(npc, waypoints, dt) {
  const target = waypoints[npc.index];
  const dx = target.x - npc.position.x;
  const dz = target.z - npc.position.z;
  const dist = Math.hypot(dx, dz);
  const step = npc.speed * dt;
  if (dist <= step) {
    return { position: { x: target.x, z: target.z }, index: (npc.index + 1) % waypoints.length, speed: npc.speed };
  }
  return {
    position: { x: npc.position.x + (dx / dist) * step, z: npc.position.z + (dz / dist) * step },
    index: npc.index,
    speed: npc.speed,
  };
}
`,
  tests: [
    { name: 'walks toward the target at its speed', args: [{ position: { x: 0, z: 0 }, index: 0, speed: 2 }, [{ x: 10, z: 0 }, { x: 10, z: 10 }], 0.5], expected: { position: { x: 1, z: 0 }, index: 0, speed: 2 } },
    { name: 'diagonal movement keeps the same speed', args: [{ position: { x: 0, z: 0 }, index: 0, speed: 5 }, [{ x: 30, z: 40 }, { x: 0, z: 0 }], 1], expected: { position: { x: 3, z: 4 }, index: 0, speed: 5 } },
    { name: 'arriving snaps onto the waypoint and advances', args: [{ position: { x: 9.5, z: 0 }, index: 0, speed: 2 }, [{ x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }], 0.5], expected: { position: { x: 10, z: 0 }, index: 1, speed: 2 } },
    { name: 'the last waypoint loops back to the first', args: [{ position: { x: 0, z: 9.9 }, index: 2, speed: 2 }, [{ x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }], 0.5], expected: { position: { x: 0, z: 10 }, index: 0, speed: 2 } },
    { name: 'does not mutate the input npc', args: [{ position: { x: 0, z: 0 }, index: 0, speed: 2 }, [{ x: 10, z: 0 }], 0.5], expected: { position: { x: 1, z: 0 }, index: 0, speed: 2 }, checkArgsUnchanged: true },
    { name: 'route check A', hidden: true, args: [{ position: { x: 2, z: 2 }, index: 1, speed: 4 }, [{ x: 0, z: 0 }, { x: 2, z: 10 }, { x: 5, z: 5 }], 0.5], expected: { position: { x: 2, z: 4 }, index: 1, speed: 4 } },
    { name: 'route check B', hidden: true, args: [{ position: { x: 4.5, z: 5 }, index: 2, speed: 4 }, [{ x: 0, z: 0 }, { x: 2, z: 10 }, { x: 5, z: 5 }], 0.5], expected: { position: { x: 5, z: 5 }, index: 0, speed: 4 } },
  ],
};
