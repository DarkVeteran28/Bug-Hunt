// Central, tunable game balance. Server and client both import this file,
// but only the server's copy is trusted for scoring and combat decisions.

export const SCORING = Object.freeze({
  bug: { easy: 100, medium: 250, hard: 500, expert: 1000 },
  // Share of the bug reward paid when the player revealed the solution in Easy mode.
  assistedFactor: 0.5,
  combat: {
    elimination: 100,
    // Kills on the same victim inside this window beyond the cap earn nothing
    // (stops two friends farming each other through respawn loops).
    farmWindowMs: 120_000,
    farmCapPerVictim: 3,
  },
  arenaRoundWin: 500,
  hintPenalty: 0,
  cityCleared: 2000,
});

export const WEAPONS = Object.freeze({
  pistol: { id: 'pistol', name: 'Pistol', slot: 1, damage: 25, pellets: 1, spread: 0.0, fireIntervalMs: 320, range: 60, magSize: 12, reserve: 60, reloadMs: 1200, auto: false },
  smg: { id: 'smg', name: 'SMG', slot: 2, damage: 11, pellets: 1, spread: 0.035, fireIntervalMs: 95, range: 40, magSize: 30, reserve: 150, reloadMs: 1800, auto: true },
  shotgun: { id: 'shotgun', name: 'Shotgun', slot: 3, damage: 12, pellets: 8, spread: 0.09, fireIntervalMs: 850, range: 18, magSize: 6, reserve: 30, reloadMs: 2200, auto: false },
  rifle: { id: 'rifle', name: 'Rifle', slot: 4, damage: 45, pellets: 1, spread: 0.0, fireIntervalMs: 650, range: 140, magSize: 8, reserve: 40, reloadMs: 2000, auto: false },
});

// Which challenge (if any) unlocks each weapon. Pistol is always owned.
export const WEAPON_UNLOCKS = Object.freeze({
  pistol: null,
  smg: 'infinite-ammo',
  shotgun: 'broken-reload',
  rifle: 'faulty-checkpoint',
});

export const PLAYER = Object.freeze({
  maxHealth: 100,
  radius: 0.4,
  height: 1.8,
  eyeHeight: 1.55,
  walkSpeed: 5.0,
  sprintSpeed: 8.5,
  jumpVelocity: 7.5,
  gravity: 22,
  respawnDelayMs: 3000,
  spawnProtectionMs: 3000,
  disconnectGraceMs: 30_000,
});

export const VEHICLE = Object.freeze({
  maxSpeed: 26,
  enterRange: 4.5,
});

export const NET = Object.freeze({
  clientSendHz: 20,
  snapshotHz: 15,
  interestRadius: 260,
  interpolationDelayMs: 120,
  // Movement validation tolerance (units/second) on top of the max legit speed.
  speedTolerance: 1.6,
});

export const MODES = Object.freeze({
  freeroam: { id: 'freeroam', name: 'Free Roam', safeDebugging: true, roundMs: 0 },
  arena: { id: 'arena', name: 'Bug Hunt Arena', safeDebugging: false, roundMs: 8 * 60_000 },
});

export const SANDBOX = Object.freeze({
  maxCodeBytes: 20_000,
  perTestTimeoutMs: 250,
  processTimeoutMs: 4000,
  memoryLimitMb: 64,
  submissionsPerWindow: 6,
  submissionWindowMs: 20_000,
});
