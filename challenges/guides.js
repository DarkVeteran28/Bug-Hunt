// Easy-mode guidance: plain-language explanations of each seeded bug, and the
// exact text on each buggy line so the editor can highlight it. These are
// shown to players who turn on Easy mode; the reference solutions stay on the
// game engine until a player explicitly asks for one (which halves the reward).
export const GUIDES = Object.freeze({
  'ghost-wall': [
    { find: 'a.min.x <= b.min.x', say: 'This checks whether box b fits completely inside box a. You want to know whether they touch at all. On each axis that is: a.min < b.max && a.max > b.min.' },
    { find: 'a.min.y <= b.min.y', say: 'Same mistake on the y axis.' },
    { find: 'a.min.z <= b.min.z', say: 'Same mistake on the z axis.' },
  ],
  'broken-car': [
    { find: 'vehicle.driver !== null && distance > range', say: 'Two comparisons are flipped. The car must be empty (driver === null) and you must be close enough (distance <= range).' },
  ],
  'invisible-gate': [
    { find: 'solid: gate.solid', say: 'The gate copies its old "solid" value, so it never stops blocking. It should be solid only when it is not open: solid: !open.' },
  ],
  'broken-mission': [
    { find: "event.to === 'npc-vera'", say: 'A deliver event looks like { type: "deliver", npc: "npc-vera" }. There is no "to" property. Read event.npc instead.' },
    { find: "if (event.type === 'pickup') return 'delivering';", say: 'A "fail" event should also send the mission back to "idle" from this state. Add: if (event.type === "fail") return "idle";' },
  ],
  'teleporting-npc': [
    { find: 'npc.index + 1 % waypoints.length', say: '% runs before +, so this is index + (1 % length) and the index runs past the end of the list. Add brackets: (npc.index + 1) % waypoints.length.' },
    { find: 'npc.position.x + dx * step', say: 'dx and dz are the full distance to the waypoint, so the NPC jumps. Divide by dist first: dx / dist * step (and the same for dz).' },
  ],
  'frozen-player': [
    { find: 'Math.floor(alpha)', say: 'Math.floor turns every alpha between 0 and 1 into 0, so the player never moves between snapshots. Use alpha directly.' },
    { find: 'return { x: first.x, y: first.y, z: first.z };\n}', say: 'When renderTime is after every snapshot, show the newest snapshot (the last one in the buffer), not the first.' },
  ],
  'flying-car': [
    { find: 'state.velocityY - GRAVITY * dt', say: 'GRAVITY is already negative (-20). Subtracting it pushes the car up. Add it instead: velocityY + GRAVITY * dt.' },
    { find: 'if (y < 0) {', say: 'When the car reaches the ground (y <= 0) it should also set grounded = true.' },
  ],
  'broken-reload': [
    { find: 'weapon.reloadStartedAt - now', say: 'This is backwards and always negative. Time passed is now - weapon.reloadStartedAt.' },
    { find: 'elapsed > weapon.reloadMs', say: 'A reload that has lasted exactly reloadMs is finished. Use >=.' },
    { find: 'const needed = weapon.magSize - weapon.ammo;', say: 'You can only take as many rounds as the reserve has. Use Math.min(needed, weapon.reserve) for the rounds you move.' },
  ],
  'infinite-ammo': [
    { find: 'next.ammo - 1;', say: 'This works out ammo - 1 and throws the answer away. Store it: next.ammo = next.ammo - 1 (or put ammo: weapon.ammo - 1 in the object).' },
    { find: 'weapon.ammo < 0', say: 'An empty magazine has 0 rounds, so block firing when ammo <= 0.' },
    { find: '<= weapon.fireIntervalMs', say: 'A shot exactly fireIntervalMs later is allowed. Block only when the gap is < fireIntervalMs.' },
  ],
  'faulty-checkpoint': [
    { find: 'pos.z - checkpoint.center.x', say: 'Typo: z is compared with center.x. Use checkpoint.center.z.' },
    { find: 'dx * dx + dy * dy + dz * dz', say: 'The checkpoint is a standing cylinder, so height does not count in the distance. Use only dx * dx + dz * dz.' },
    { find: 'distSq < checkpoint.radius', say: 'distSq is a squared distance. Compare it with radius * radius, and use <= so the edge counts.' },
    { find: 'pos.y <= checkpoint.height', say: 'The top of the cylinder is center.y + height, not just height.' },
  ],
  'double-score': [
    { find: 'if (ledger.completed.includes(e.missionId)) continue;', say: 'This only checks the old ledger, so the same mission twice in one batch pays twice. Check the "completed" list you are building instead.' },
    { find: 'total += e.reward;', say: 'Rewards that are 0, negative or not a real number must be skipped. Before paying, check: typeof e.reward === "number" && Number.isFinite(e.reward) && e.reward > 0.' },
  ],
  'broken-final-gate': [
    { find: '!progress.solved.indexOf(id)', say: 'indexOf gives 0 for the first item and -1 when missing, so this test is wrong. Use !progress.solved.includes(id).' },
    { find: 'progress.districtsUnlocked.length > rules.requiredDistricts', say: 'Flipped: "districts" is missing when FEWER than requiredDistricts are unlocked. Use <.' },
    { find: 'progress.missionsCompleted.length <= rules.minMissions', say: 'Having exactly minMissions is enough. Missions are missing only when the count is < minMissions.' },
    { find: '|| progress.solved.length > 0', say: 'This opens the gate as soon as any bug is solved. The gate should open only when nothing is missing: open: missing.length === 0.' },
  ],
});
