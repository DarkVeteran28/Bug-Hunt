export default {
  id: 'invisible-gate',
  title: 'Invisible Gate',
  difficulty: 'medium',
  district: 'ocean',
  mandatory: true,
  entry: 'updateGate',
  summary: 'The Downtown gate opens but stays solid.',
  description:
    'The gate controller animates the Downtown gate, but its collision state never changes, so an open gate still blocks you. ' +
    'Fix updateGate() so collision follows the gate. This is the mandatory challenge for Ocean Drive: verifying it unlocks Downtown.',
  reproduce: [
    'Go to the gate at the east end of the middle avenue.',
    'Press E on the gate controller panel to run a test cycle.',
    'The door slides up, but you still bump into an invisible wall.',
  ],
  hints: [
    'The gate should only be solid while it is not fully open.',
    'Return solid: !open instead of copying the old value.',
  ],
  consequence: 'Unlocks Downtown. The gate opens and stops blocking you.',
  starterCode: `// gate:     { open: boolean, solid: boolean, progress: number } (progress 0 = closed, 1 = open)
// unlocked: true when this player is allowed through
// dt:       seconds since the last update
// Returns the next gate state. The door takes 2 seconds to fully open or close.
function updateGate(gate, unlocked, dt) {
  const speed = 0.5;
  let progress = gate.progress;
  if (unlocked) {
    progress = Math.min(1, progress + speed * dt);
  } else {
    progress = Math.max(0, progress - speed * dt);
  }
  const open = progress >= 1;
  return { open, solid: gate.solid, progress };
}
`,
  solutionCode: `function updateGate(gate, unlocked, dt) {
  const speed = 0.5;
  let progress = gate.progress;
  if (unlocked) progress = Math.min(1, progress + speed * dt);
  else progress = Math.max(0, progress - speed * dt);
  const open = progress >= 1;
  return { open, solid: !open, progress };
}
`,
  tests: [
    { name: 'locked gate stays closed and solid', args: [{ open: false, solid: true, progress: 0 }, false, 0.5], expected: { open: false, solid: true, progress: 0 } },
    { name: 'unlocking starts opening but is still solid', args: [{ open: false, solid: true, progress: 0 }, true, 1], expected: { open: false, solid: true, progress: 0.5 } },
    { name: 'fully open gate is no longer solid', args: [{ open: false, solid: true, progress: 0.75 }, true, 1], expected: { open: true, solid: false, progress: 1 } },
    { name: 'open gate stays passable', args: [{ open: true, solid: false, progress: 1 }, true, 0.1], expected: { open: true, solid: false, progress: 1 } },
    { name: 'closing gate becomes solid again immediately', args: [{ open: true, solid: false, progress: 1 }, false, 0.2], expected: { open: false, solid: true, progress: 0.9 }, tolerance: 1e-9 },
    { name: 'gate check A', hidden: true, args: [{ open: false, solid: true, progress: 0.9 }, true, 0.25], expected: { open: true, solid: false, progress: 1 } },
    { name: 'gate check B', hidden: true, args: [{ open: true, solid: false, progress: 1 }, false, 4], expected: { open: false, solid: true, progress: 0 } },
  ],
};
