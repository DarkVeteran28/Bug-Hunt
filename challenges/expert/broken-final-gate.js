export default {
  id: 'broken-final-gate',
  title: 'Broken Final Gate',
  difficulty: 'expert',
  district: 'industrial',
  mandatory: true,
  entry: 'canOpenFinalGate',
  summary: 'The Final Vault stays locked.',
  description:
    'The Final Vault controller decides whether you have earned entry with canOpenFinalGate(). Its progression checks are wrong in several places, so it reports nonsense and refuses honest players. ' +
    'Fix it. The server then evaluates the approved rule against your server-side progress and opens the vault for you.',
  reproduce: [
    'Go to the Final Vault Controller in the Industrial Zone plaza.',
    'Press E to ask the controller what is missing.',
    'Its answer is wrong, and the vault stays shut.',
  ],
  hints: [
    'indexOf returns -1 when an item is missing and 0 for the first item. Prefer includes().',
    'Re-read each comparison. "requiredDistricts" is a minimum. The gate opens only when nothing is missing.',
  ],
  consequence: 'The Final Vault opens once your real progress meets the rules.',
  starterCode: `// progress: { solved: string[], districtsUnlocked: string[], missionsCompleted: string[] }
// rules:    { requiredChallenges: string[], requiredDistricts: number, minMissions: number }
// Returns { open: boolean, missing: string[] }.
// missing lists unmet requirements in this order:
//   'challenge:<id>' for each required challenge not solved (in rules order),
//   then 'districts' if fewer than requiredDistricts are unlocked,
//   then 'missions' if fewer than minMissions are completed.
// The gate is open only when nothing is missing.
function canOpenFinalGate(progress, rules) {
  const missing = [];
  for (const id of rules.requiredChallenges) {
    if (!progress.solved.indexOf(id)) missing.push('challenge:' + id);
  }
  if (progress.districtsUnlocked.length > rules.requiredDistricts) {
    missing.push('districts');
  }
  if (progress.missionsCompleted.length <= rules.minMissions) {
    missing.push('missions');
  }
  return { open: missing.length === 0 || progress.solved.length > 0, missing };
}
`,
  solutionCode: `function canOpenFinalGate(progress, rules) {
  const missing = [];
  for (const id of rules.requiredChallenges) {
    if (!progress.solved.includes(id)) missing.push('challenge:' + id);
  }
  if (progress.districtsUnlocked.length < rules.requiredDistricts) missing.push('districts');
  if (progress.missionsCompleted.length < rules.minMissions) missing.push('missions');
  return { open: missing.length === 0, missing };
}
`,
  tests: [
    { name: 'everything done opens the gate', args: [{ solved: ['a', 'b', 'c'], districtsUnlocked: ['d1', 'd2', 'd3'], missionsCompleted: ['m1', 'm2'] }, { requiredChallenges: ['a', 'b'], requiredDistricts: 3, minMissions: 2 }], expected: { open: true, missing: [] } },
    { name: 'the first required challenge is detected as solved', args: [{ solved: ['a'], districtsUnlocked: ['d1'], missionsCompleted: ['m1'] }, { requiredChallenges: ['a'], requiredDistricts: 1, minMissions: 1 }], expected: { open: true, missing: [] } },
    { name: 'unsolved challenges are listed in rules order', args: [{ solved: ['b'], districtsUnlocked: ['d1', 'd2'], missionsCompleted: ['m1'] }, { requiredChallenges: ['c', 'a', 'b'], requiredDistricts: 2, minMissions: 1 }], expected: { open: false, missing: ['challenge:c', 'challenge:a'] } },
    { name: 'too few districts', args: [{ solved: ['a'], districtsUnlocked: ['d1'], missionsCompleted: ['m1', 'm2'] }, { requiredChallenges: ['a'], requiredDistricts: 5, minMissions: 2 }], expected: { open: false, missing: ['districts'] } },
    { name: 'too few missions', args: [{ solved: ['a'], districtsUnlocked: ['d1', 'd2'], missionsCompleted: [] }, { requiredChallenges: ['a'], requiredDistricts: 2, minMissions: 1 }], expected: { open: false, missing: ['missions'] } },
    { name: 'nothing done lists everything', args: [{ solved: [], districtsUnlocked: [], missionsCompleted: [] }, { requiredChallenges: ['x', 'y'], requiredDistricts: 1, minMissions: 1 }], expected: { open: false, missing: ['challenge:x', 'challenge:y', 'districts', 'missions'] } },
    { name: 'solving unrelated challenges is not enough', args: [{ solved: ['z'], districtsUnlocked: ['d1'], missionsCompleted: ['m1'] }, { requiredChallenges: ['x'], requiredDistricts: 1, minMissions: 1 }], expected: { open: false, missing: ['challenge:x'] } },
    { name: 'controller check A', hidden: true, args: [{ solved: ['q', 'p'], districtsUnlocked: ['d1', 'd2', 'd3'], missionsCompleted: ['m'] }, { requiredChallenges: ['p', 'q'], requiredDistricts: 4, minMissions: 1 }], expected: { open: false, missing: ['districts'] } },
    { name: 'controller check B', hidden: true, args: [{ solved: ['p', 'p'], districtsUnlocked: ['d1'], missionsCompleted: ['m', 'n'] }, { requiredChallenges: ['p'], requiredDistricts: 1, minMissions: 2 }], expected: { open: true, missing: [] } },
  ],
};
