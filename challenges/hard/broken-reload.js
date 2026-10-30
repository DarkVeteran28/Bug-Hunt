export default {
  id: 'broken-reload',
  title: 'Broken Reload',
  difficulty: 'hard',
  district: 'port',
  mandatory: false,
  entry: 'updateReload',
  unlocksWeapon: 'shotgun',
  summary: 'Reloading at the armory bench never finishes.',
  description:
    'The Vice Port armory bench runs a training weapon through updateReload(). The reload bar never completes, and the logic also invents ammunition that is not in reserve. ' +
    'This only affects the training weapon: real weapon reloads are always handled by the game engine. Fixing it unlocks the Shotgun.',
  reproduce: [
    'Go to the Armory Reload Bench in Vice Port.',
    'Press E to run a reload drill on the training weapon.',
    'The reload never completes.',
  ],
  hints: [
    'Elapsed time is now - reloadStartedAt, not the other way round. A reload that has lasted exactly reloadMs is done.',
    'You can only move as many rounds as the reserve actually holds.',
  ],
  consequence: 'Unlocks the Shotgun (weapon slot 3).',
  starterCode: `// weapon: { ammo, reserve, magSize, reloading, reloadStartedAt, reloadMs }
// now:    current time in ms
// Returns a NEW weapon state. When the reload time has fully elapsed,
// fill the magazine from the reserve and stop reloading.
function updateReload(weapon, now) {
  if (!weapon.reloading) return weapon;
  const elapsed = weapon.reloadStartedAt - now;
  if (elapsed > weapon.reloadMs) {
    const needed = weapon.magSize - weapon.ammo;
    return {
      ...weapon,
      ammo: weapon.ammo + needed,
      reserve: weapon.reserve - needed,
      reloading: false,
    };
  }
  return weapon;
}
`,
  solutionCode: `function updateReload(weapon, now) {
  if (!weapon.reloading) return weapon;
  const elapsed = now - weapon.reloadStartedAt;
  if (elapsed >= weapon.reloadMs) {
    const needed = weapon.magSize - weapon.ammo;
    const taken = Math.max(0, Math.min(needed, weapon.reserve));
    return { ...weapon, ammo: weapon.ammo + taken, reserve: weapon.reserve - taken, reloading: false };
  }
  return weapon;
}
`,
  tests: [
    { name: 'not reloading: nothing changes', args: [{ ammo: 3, reserve: 20, magSize: 12, reloading: false, reloadStartedAt: 0, reloadMs: 1000 }, 5000], expected: { ammo: 3, reserve: 20, magSize: 12, reloading: false, reloadStartedAt: 0, reloadMs: 1000 } },
    { name: 'still reloading halfway through', args: [{ ammo: 3, reserve: 20, magSize: 12, reloading: true, reloadStartedAt: 1000, reloadMs: 1000 }, 1500], expected: { ammo: 3, reserve: 20, magSize: 12, reloading: true, reloadStartedAt: 1000, reloadMs: 1000 } },
    { name: 'reload completes after the reload time', args: [{ ammo: 3, reserve: 20, magSize: 12, reloading: true, reloadStartedAt: 1000, reloadMs: 1000 }, 2600], expected: { ammo: 12, reserve: 11, magSize: 12, reloading: false, reloadStartedAt: 1000, reloadMs: 1000 } },
    { name: 'reload completes exactly on time', args: [{ ammo: 0, reserve: 50, magSize: 8, reloading: true, reloadStartedAt: 0, reloadMs: 2000 }, 2000], expected: { ammo: 8, reserve: 42, magSize: 8, reloading: false, reloadStartedAt: 0, reloadMs: 2000 } },
    { name: 'a low reserve only partly fills the magazine', args: [{ ammo: 2, reserve: 4, magSize: 12, reloading: true, reloadStartedAt: 0, reloadMs: 1000 }, 1200], expected: { ammo: 6, reserve: 0, magSize: 12, reloading: false, reloadStartedAt: 0, reloadMs: 1000 } },
    { name: 'does not mutate the input', args: [{ ammo: 1, reserve: 30, magSize: 12, reloading: true, reloadStartedAt: 0, reloadMs: 1000 }, 1500], expected: { ammo: 12, reserve: 19, magSize: 12, reloading: false, reloadStartedAt: 0, reloadMs: 1000 }, checkArgsUnchanged: true },
    { name: 'reload check A', hidden: true, args: [{ ammo: 5, reserve: 0, magSize: 6, reloading: true, reloadStartedAt: 100, reloadMs: 50 }, 400], expected: { ammo: 5, reserve: 0, magSize: 6, reloading: false, reloadStartedAt: 100, reloadMs: 50 } },
    { name: 'reload check B', hidden: true, args: [{ ammo: 1, reserve: 9, magSize: 6, reloading: true, reloadStartedAt: 100, reloadMs: 300 }, 399], expected: { ammo: 1, reserve: 9, magSize: 6, reloading: true, reloadStartedAt: 100, reloadMs: 300 } },
  ],
};
