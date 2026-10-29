export default {
  id: 'infinite-ammo',
  title: 'Infinite Ammo',
  difficulty: 'hard',
  district: 'neon',
  mandatory: false,
  entry: 'tryFire',
  unlocksWeapon: 'smg',
  summary: 'The shooting-range blaster never runs out of ammo.',
  description:
    'The Neon shooting range uses tryFire() for its training blaster. Its ammo counter never goes down, and an empty blaster can still fire. ' +
    'This only affects the range blaster: competitive weapons are always validated by the server. Fixing it unlocks the SMG.',
  reproduce: [
    'Go to the Shooting Range Console in the Neon District.',
    'Press E to fire a test burst of six shots.',
    'The ammo counter stays at the same value.',
  ],
  hints: [
    'next.ammo - 1 computes a value and throws it away. You need to assign it.',
    'An empty magazine has 0 rounds. Check the boundary condition, and check the cooldown boundary as well: a shot exactly fireIntervalMs later is allowed.',
  ],
  consequence: 'Unlocks the SMG (weapon slot 2).',
  starterCode: `// weapon: { ammo, lastShotAt, fireIntervalMs, reloading }
// now:    current time in ms
// Returns { fired: boolean, weapon: NEW weapon state }.
// A shot is allowed when not reloading, the cooldown has passed and there is ammo.
function tryFire(weapon, now) {
  if (weapon.reloading) return { fired: false, weapon };
  if (now - weapon.lastShotAt <= weapon.fireIntervalMs) return { fired: false, weapon };
  if (weapon.ammo < 0) return { fired: false, weapon };
  const next = { ...weapon, lastShotAt: now };
  next.ammo - 1;
  return { fired: true, weapon: next };
}
`,
  solutionCode: `function tryFire(weapon, now) {
  if (weapon.reloading) return { fired: false, weapon };
  if (now - weapon.lastShotAt < weapon.fireIntervalMs) return { fired: false, weapon };
  if (weapon.ammo <= 0) return { fired: false, weapon };
  const next = { ...weapon, lastShotAt: now, ammo: weapon.ammo - 1 };
  return { fired: true, weapon: next };
}
`,
  tests: [
    { name: 'firing uses one round', args: [{ ammo: 12, lastShotAt: 0, fireIntervalMs: 300, reloading: false }, 1000], expected: { fired: true, weapon: { ammo: 11, lastShotAt: 1000, fireIntervalMs: 300, reloading: false } } },
    { name: 'cannot fire during the cooldown', args: [{ ammo: 12, lastShotAt: 1000, fireIntervalMs: 300, reloading: false }, 1200], expected: { fired: false, weapon: { ammo: 12, lastShotAt: 1000, fireIntervalMs: 300, reloading: false } } },
    { name: 'can fire exactly when the cooldown ends', args: [{ ammo: 5, lastShotAt: 1000, fireIntervalMs: 300, reloading: false }, 1300], expected: { fired: true, weapon: { ammo: 4, lastShotAt: 1300, fireIntervalMs: 300, reloading: false } } },
    { name: 'an empty magazine cannot fire', args: [{ ammo: 0, lastShotAt: 0, fireIntervalMs: 300, reloading: false }, 5000], expected: { fired: false, weapon: { ammo: 0, lastShotAt: 0, fireIntervalMs: 300, reloading: false } } },
    { name: 'cannot fire while reloading', args: [{ ammo: 5, lastShotAt: 0, fireIntervalMs: 300, reloading: true }, 5000], expected: { fired: false, weapon: { ammo: 5, lastShotAt: 0, fireIntervalMs: 300, reloading: true } } },
    { name: 'does not mutate the input', args: [{ ammo: 2, lastShotAt: 0, fireIntervalMs: 100, reloading: false }, 1000], expected: { fired: true, weapon: { ammo: 1, lastShotAt: 1000, fireIntervalMs: 100, reloading: false } }, checkArgsUnchanged: true },
    { name: 'fire check A', hidden: true, args: [{ ammo: 1, lastShotAt: 50, fireIntervalMs: 900, reloading: false }, 950], expected: { fired: true, weapon: { ammo: 0, lastShotAt: 950, fireIntervalMs: 900, reloading: false } } },
    { name: 'fire check B', hidden: true, args: [{ ammo: 9, lastShotAt: 50, fireIntervalMs: 900, reloading: false }, 949], expected: { fired: false, weapon: { ammo: 9, lastShotAt: 50, fireIntervalMs: 900, reloading: false } } },
  ],
};
