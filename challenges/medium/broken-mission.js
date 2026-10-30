export default {
  id: 'broken-mission',
  title: 'Broken Mission',
  difficulty: 'medium',
  district: 'downtown',
  mandatory: true,
  entry: 'nextMissionState',
  summary: 'The courier mission never completes.',
  description:
    'The "Special Delivery" mission uses a small state machine. Rico hands you a package, but when you reach Vera the mission stays stuck in "delivering". ' +
    'Fix nextMissionState(). The game then uses the approved state machine for your courier mission, and Vice Port unlocks.',
  reproduce: [
    'In Downtown, walk to Rico (yellow) and press E to accept the package.',
    'Walk to Vera (pink) and press E to deliver it.',
    'The mission tracker still says "Deliver to Vera".',
  ],
  hints: [
    'Look closely at which property of the deliver event is read. What does a deliver event actually contain?',
    'A "fail" event should reset the mission to idle from both "pickup" and "delivering".',
  ],
  consequence: 'Unlocks Vice Port, and the courier mission can be completed.',
  starterCode: `// States flow: 'idle' -> 'pickup' -> 'delivering' -> 'complete'
// Events look like:
//   { type: 'accept' }
//   { type: 'pickup' }
//   { type: 'deliver', npc: 'npc-vera' }
//   { type: 'fail' }
// Returns the next state. Unknown events leave the state unchanged.
function nextMissionState(state, event) {
  switch (state) {
    case 'idle':
      return event.type === 'accept' ? 'pickup' : 'idle';
    case 'pickup':
      if (event.type === 'pickup') return 'delivering';
      return state;
    case 'delivering':
      if (event.type === 'deliver' && event.to === 'npc-vera') return 'complete';
      if (event.type === 'fail') return 'idle';
      return state;
    case 'complete':
      return 'complete';
    default:
      return 'idle';
  }
}
`,
  solutionCode: `function nextMissionState(state, event) {
  switch (state) {
    case 'idle':
      return event.type === 'accept' ? 'pickup' : 'idle';
    case 'pickup':
      if (event.type === 'pickup') return 'delivering';
      if (event.type === 'fail') return 'idle';
      return state;
    case 'delivering':
      if (event.type === 'deliver' && event.npc === 'npc-vera') return 'complete';
      if (event.type === 'fail') return 'idle';
      return state;
    case 'complete':
      return 'complete';
    default:
      return 'idle';
  }
}
`,
  tests: [
    { name: 'accepting the mission', args: ['idle', { type: 'accept' }], expected: 'pickup' },
    { name: 'picking up the package', args: ['pickup', { type: 'pickup' }], expected: 'delivering' },
    { name: 'delivering to Vera completes the mission', args: ['delivering', { type: 'deliver', npc: 'npc-vera' }], expected: 'complete' },
    { name: 'delivering to the wrong NPC does nothing', args: ['delivering', { type: 'deliver', npc: 'npc-rico' }], expected: 'delivering' },
    { name: 'failing during pickup resets', args: ['pickup', { type: 'fail' }], expected: 'idle' },
    { name: 'failing during delivery resets', args: ['delivering', { type: 'fail' }], expected: 'idle' },
    { name: 'completed missions stay complete', args: ['complete', { type: 'fail' }], expected: 'complete' },
    { name: 'state check A', hidden: true, args: ['delivering', { type: 'deliver', npc: 'npc-vera', to: 'npc-rico' }], expected: 'complete' },
    { name: 'state check B', hidden: true, args: ['idle', { type: 'deliver', npc: 'npc-vera' }], expected: 'idle' },
  ],
};
