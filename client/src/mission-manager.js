// Client view of missions, gates and in-world station demos. The server owns
// mission progress and unlocks; this module shows them and runs the local,
// observable side of each bug.
import { MISSIONS, MISSION_NPCS, DISTRICTS, districtIndexAt } from '/shared/world-data.js';
import { call } from './challenge-runtime.js';
import { sfx } from './audio.js';

const NPC_POS = Object.fromEntries(MISSION_NPCS.map((n) => [n.id, n.pos]));

export class MissionView {
  constructor({ world, hud }) {
    this.world = world;
    this.hud = hud;
    this.missions = [];
    this.progress = { districts: ['ocean'], solved: [], gates: [] };
  }

  setMissions(list) {
    this.missions = list;
  }

  setProgress(p) {
    this.progress = p;
  }

  current(playerPos) {
    const here = DISTRICTS[districtIndexAt(playerPos.x)].id;
    const open = this.missions.filter((m) => !m.done && this.progress.districts.includes(m.district));
    return open.find((m) => m.district === here) || open[0] || null;
  }

  targetOf(m) {
    const spec = MISSIONS.find((x) => x.id === m.id);
    const step = spec && spec.steps[m.step];
    if (!step) return null;
    if (step.type === 'talk') return NPC_POS[step.npc];
    return step.pos;
  }

  update(playerPos) {
    const m = this.current(playerPos);
    const target = m ? this.targetOf(m) : null;
    const beacon = this.world.beacon;
    beacon.visible = !!target;
    if (target) beacon.position.set(target[0], 30, target[2]);
    const dist = target ? Math.hypot(target[0] - playerPos.x, target[2] - playerPos.z) : null;
    this.hud.missionTracker(m, dist);
    // Checkpoint rings: bright for the next one, dim for the rest.
    const neon = this.missions.find((x) => x.id === 'm-neon');
    for (const r of this.world.ringMeshes) {
      const active = neon && !neon.done && r.step === neon.step;
      const done = neon && (neon.done || r.step < neon.step);
      r.ring.visible = r.col.visible = !done;
      r.ring.material.opacity = active ? 0.95 : 0.35;
      r.col.material.opacity = active ? 0.14 : 0.04;
    }
    return target;
  }
}

/** Gate animation and collision. The Downtown gate runs the invisible-gate challenge function. */
export class GateController {
  constructor({ world, physics }) {
    this.world = world;
    this.physics = physics;
    this.state = new Map();
    for (const id of world.gates.keys()) this.state.set(id, { open: false, solid: true, progress: 0 });
    this.testCycleLeft = 0; // seconds of game time, so slow frame rates still see a full open
    this.unlocked = new Set();
  }

  setUnlocked(ids) {
    for (const id of ids) {
      if (!this.unlocked.has(id)) sfx.door();
    }
    this.unlocked = new Set(ids);
  }

  startTestCycle(ms = 6000) {
    this.testCycleLeft = ms / 1000;
    sfx.door();
  }

  update(dt) {
    this.testCycleLeft = Math.max(0, this.testCycleLeft - dt);
    for (const [id, g] of this.world.gates) {
      const prev = this.state.get(id);
      const unlocked = this.unlocked.has(id);
      let next;
      if (id === 'gate-downtown') {
        const want = unlocked || this.testCycleLeft > 0;
        next = call('invisible-gate', [{ ...prev }, want, dt], null);
        if (!next || typeof next.progress !== 'number' || !Number.isFinite(next.progress) || typeof next.solid !== 'boolean') next = { ...prev };
        next.progress = Math.max(0, Math.min(1, next.progress));
      } else {
        const progress = Math.max(0, Math.min(1, prev.progress + (unlocked ? 0.5 : -0.5) * dt));
        next = { open: progress >= 1, solid: progress < 1, progress };
      }
      this.state.set(id, next);
      this.physics.setGateSolid(id, next.solid);
      g.door.position.y = g.baseY + next.progress * (g.height + 0.3);
      g.panel.material.emissive.set(unlocked ? '#4dff9a' : '#ff4f5e');
      g.door.material.emissive.set(next.solid ? '#ff2f6d' : '#4dff9a');
    }
  }
}

/** In-world demonstrations triggered with F at a station: they run the challenge function live. */
export class StationDemos {
  constructor({ hud, gates, weapons }) {
    this.hud = hud;
    this.gates = gates;
    this.weapons = weapons;
    this.active = null;
  }

  describe(id) {
    return {
      'ghost-wall': 'Walk into the pink Sunset Hotel to see the bug',
      'broken-car': 'Press E next to a car to see the bug',
      'invisible-gate': 'Run a gate test cycle',
      'broken-mission': 'Talk to Rico, then Vera, to see the bug',
      'teleporting-npc': 'Watch the pedestrians to see the bug',
      'frozen-player': 'Watch other players move to see the bug',
      'flying-car': 'Drive the green Dock Hauler to see the bug',
      'broken-reload': 'Run a reload drill',
      'infinite-ammo': 'Fire a test burst',
      'faulty-checkpoint': 'Run through the magenta Neon Run rings',
      'double-score': 'Process a test payout batch',
      'broken-final-gate': 'Ask the vault controller',
    }[id];
  }

  hasDemo(id) {
    return ['invisible-gate', 'broken-reload', 'infinite-ammo', 'double-score', 'broken-final-gate'].includes(id);
  }

  run(id, progress) {
    switch (id) {
      case 'invisible-gate': {
        this.gates.startTestCycle();
        this.hud.toast('Gate test cycle: the controller opens the Downtown gate for 6 seconds. Try walking through it.', '', 6000);
        break;
      }
      case 'broken-reload': {
        const start = performance.now();
        this.active = { id, start, weapon: { ammo: 2, reserve: 20, magSize: 12, reloading: true, reloadStartedAt: start, reloadMs: 1500 } };
        break;
      }
      case 'infinite-ammo': {
        let weapon = { ammo: 30, lastShotAt: 0, fireIntervalMs: 100, reloading: false };
        const before = weapon.ammo;
        let fired = 0;
        let t = performance.now();
        for (let i = 0; i < 6; i++) {
          t += 150;
          const r = call('infinite-ammo', [weapon, t], null);
          if (!r || !r.weapon) break;
          if (r.fired) fired++;
          weapon = r.weapon;
        }
        sfx.shot('smg');
        const ok = weapon.ammo === before - fired && fired === 6;
        this.hud.drill(`Range Blaster test burst: fired ${fired} shots · ammo ${before} → ${weapon.ammo}${ok ? ' ✔' : ' ✘ (should be ' + (before - 6) + ')'}`);
        this.hud.toast(ok ? 'The blaster counts ammo correctly now.' : 'The ammo counter did not go down. That is the Infinite Ammo bug.', ok ? 'good' : 'warn');
        setTimeout(() => this.hud.drill(null), 5000);
        break;
      }
      case 'double-score': {
        const ledger = { completed: ['m-ocean'], total: 150 };
        const batch = [{ missionId: 'm-neon', reward: 300 }, { missionId: 'm-neon', reward: 300 }, { missionId: 'hack', reward: -500 }];
        const r = call('double-score', [ledger, batch], null);
        const total = r && r.ledger ? r.ledger.total : '?';
        const ok = total === 450;
        this.hud.drill(`Payout batch: m-neon ×2 and a bogus -500 · ledger total ${total}${ok ? ' ✔' : ' ✘ (should be 450)'}`);
        this.hud.toast(ok ? 'The terminal deduplicates payouts now.' : 'The terminal paid the duplicate. That is the Double Score bug.', ok ? 'good' : 'warn');
        setTimeout(() => this.hud.drill(null), 6000);
        break;
      }
      case 'broken-final-gate': {
        const view = { solved: progress.solved, districtsUnlocked: progress.districts, missionsCompleted: progress.missions };
        const rules = { requiredChallenges: ['invisible-gate', 'broken-mission', 'flying-car', 'double-score'], requiredDistricts: 5, minMissions: 2 };
        const r = call('broken-final-gate', [view, rules], null) || { open: false, missing: ['(controller crashed)'] };
        this.hud.drill(`Vault controller says: ${r.open ? 'OPEN' : 'LOCKED'} · missing: ${(r.missing || []).join(', ') || 'nothing'}<br/><span class="muted">Server truth: ${progress.vaultOpen ? 'vault open' : `locked (missing: ${(progress.vaultMissing || []).join(', ') || 'the Broken Final Gate fix'})`}</span>`);
        setTimeout(() => this.hud.drill(null), 7000);
        break;
      }
      default:
        this.hud.toast(this.describe(id), '');
    }
  }

  update() {
    if (!this.active || this.active.id !== 'broken-reload') return;
    const now = performance.now();
    const a = this.active;
    const next = call('broken-reload', [a.weapon, now], a.weapon) || a.weapon;
    a.weapon = next;
    const elapsed = now - a.start;
    const progress = Math.min(1, elapsed / a.weapon.reloadMs);
    if (!next.reloading) {
      this.hud.drill(`Training weapon reloaded: ${next.ammo} in the magazine, ${next.reserve} in reserve ✔`, 1);
      this.hud.toast('Reload drill completed.', 'good');
      sfx.reload();
      this.active = null;
      setTimeout(() => this.hud.drill(null), 3000);
    } else if (elapsed > 4500) {
      this.hud.drill('Reload drill: still reloading after 4.5 s ✘ (should finish in 1.5 s)', 1);
      this.hud.toast('The reload never completed. That is the Broken Reload bug.', 'warn');
      this.active = null;
      setTimeout(() => this.hud.drill(null), 4000);
    } else {
      this.hud.drill(`Reload drill… ${(elapsed / 1000).toFixed(1)} s`, progress);
    }
  }
}
