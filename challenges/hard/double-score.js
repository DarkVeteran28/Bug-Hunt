export default {
  id: 'double-score',
  title: 'Double Score',
  difficulty: 'hard',
  district: 'neon',
  mandatory: true,
  entry: 'applyCompletions',
  summary: 'The payout terminal pays the same mission twice.',
  description:
    'The Neon payout terminal batches mission completions with applyCompletions(). When the same mission appears twice in one batch it is paid twice, and bogus rewards are accepted. ' +
    'The real game server keeps its own approved, database-enforced deduplication; this terminal is a training ledger. Fixing it is the mandatory Neon challenge and unlocks the Industrial Zone.',
  reproduce: [
    'Go to the Payout Terminal on the Neon plaza.',
    'Press E to process a test batch that contains a duplicate mission.',
    'The ledger pays the duplicate.',
  ],
  hints: [
    'Check duplicates against the list you are building, not only the original ledger.',
    'A reward must be a finite number greater than 0, otherwise skip the event.',
  ],
  consequence: 'Unlocks the Industrial Zone.',
  starterCode: `// ledger: { completed: string[], total: number }
// events: array of { missionId: string, reward: number }
// Returns { ledger: NEW ledger, awarded: string[] }.
// Each mission may be paid at most once, ever. Events with a reward that is
// not a finite number greater than 0 are ignored. Do not mutate the input.
function applyCompletions(ledger, events) {
  const completed = [...ledger.completed];
  let total = ledger.total;
  const awarded = [];
  for (const e of events) {
    if (ledger.completed.includes(e.missionId)) continue;
    completed.push(e.missionId);
    total += e.reward;
    awarded.push(e.missionId);
  }
  return { ledger: { completed, total }, awarded };
}
`,
  solutionCode: `function applyCompletions(ledger, events) {
  const completed = [...ledger.completed];
  let total = ledger.total;
  const awarded = [];
  for (const e of events) {
    if (completed.includes(e.missionId)) continue;
    if (typeof e.reward !== 'number' || !Number.isFinite(e.reward) || e.reward <= 0) continue;
    completed.push(e.missionId);
    total += e.reward;
    awarded.push(e.missionId);
  }
  return { ledger: { completed, total }, awarded };
}
`,
  tests: [
    { name: 'pays a new mission', args: [{ completed: [], total: 0 }, [{ missionId: 'm1', reward: 100 }]], expected: { ledger: { completed: ['m1'], total: 100 }, awarded: ['m1'] } },
    { name: 'ignores a mission that was already paid', args: [{ completed: ['m1'], total: 100 }, [{ missionId: 'm1', reward: 100 }]], expected: { ledger: { completed: ['m1'], total: 100 }, awarded: [] } },
    { name: 'a duplicate inside the same batch is paid once', args: [{ completed: [], total: 0 }, [{ missionId: 'm2', reward: 250 }, { missionId: 'm2', reward: 250 }]], expected: { ledger: { completed: ['m2'], total: 250 }, awarded: ['m2'] } },
    { name: 'negative rewards are ignored', args: [{ completed: [], total: 50 }, [{ missionId: 'hack', reward: -1000 }]], expected: { ledger: { completed: [], total: 50 }, awarded: [] } },
    { name: 'non-numeric rewards are ignored', args: [{ completed: [], total: 0 }, [{ missionId: 'm3', reward: '9999' }, { missionId: 'm4', reward: 100 }]], expected: { ledger: { completed: ['m4'], total: 100 }, awarded: ['m4'] } },
    { name: 'does not mutate the input ledger', args: [{ completed: ['m0'], total: 10 }, [{ missionId: 'm5', reward: 5 }]], expected: { ledger: { completed: ['m0', 'm5'], total: 15 }, awarded: ['m5'] }, checkArgsUnchanged: true },
    { name: 'ledger check A', hidden: true, args: [{ completed: ['a'], total: 5 }, [{ missionId: 'b', reward: 1 }, { missionId: 'a', reward: 9 }, { missionId: 'b', reward: 1 }, { missionId: 'c', reward: 0 }]], expected: { ledger: { completed: ['a', 'b'], total: 6 }, awarded: ['b'] } },
  ],
};
