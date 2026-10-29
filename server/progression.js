// Per-player progression derived from server-side records only: solved
// challenges, completed missions, unlocked districts, owned weapons and gates.
import { DISTRICTS, getWorld, districtIndexAt, pointInBox } from '../shared/world-data.js';
import { WEAPON_UNLOCKS } from '../shared/config.js';
import { approved } from './game-logic.js';

export const FINAL_GATE_RULES = Object.freeze({
  requiredChallenges: DISTRICTS.slice(0, 4).map((d) => d.mandatory),
  requiredDistricts: DISTRICTS.length,
  minMissions: 2,
});

export class Progress {
  constructor(solvedIds = [], missionIds = [], solvedCode = {}) {
    this.solved = new Set(solvedIds);
    this.missions = new Set(missionIds);
    this.code = { ...solvedCode };
    this.recompute();
  }

  recompute() {
    const unlocked = ['ocean'];
    for (let i = 0; i < DISTRICTS.length - 1; i++) {
      if (unlocked.includes(DISTRICTS[i].id) && this.solved.has(DISTRICTS[i].mandatory)) unlocked.push(DISTRICTS[i + 1].id);
      else break;
    }
    this.districts = unlocked;
    this.weapons = Object.entries(WEAPON_UNLOCKS).filter(([, ch]) => ch === null || this.solved.has(ch)).map(([w]) => w);
    const gateCheck = approved('broken-final-gate')(
      { solved: [...this.solved], districtsUnlocked: this.districts, missionsCompleted: [...this.missions] },
      FINAL_GATE_RULES,
    );
    this.vaultOpen = this.solved.has('broken-final-gate') && gateCheck.open;
    this.vaultMissing = gateCheck.missing;
  }

  isSolved(id) {
    return this.solved.has(id);
  }

  districtUnlocked(id) {
    return this.districts.includes(id);
  }

  gateOpen(gate) {
    if (gate.unlocksVault) return this.vaultOpen;
    return this.districtUnlocked(gate.unlocksDistrict);
  }

  /** Can the player legally stand at p? (locked districts and the vault are off-limits) */
  positionAllowed(p) {
    const d = DISTRICTS[districtIndexAt(p[0])];
    if (!this.districtUnlocked(d.id)) return false;
    if (!this.vaultOpen && pointInBox(p, getWorld().vault.area, 0.2)) return false;
    return true;
  }

  toJSON() {
    return {
      solved: [...this.solved],
      missions: [...this.missions],
      districts: this.districts,
      weapons: this.weapons,
      vaultOpen: this.vaultOpen,
      vaultMissing: this.vaultMissing,
      gates: getWorld().gates.filter((g) => this.gateOpen(g)).map((g) => g.id),
      code: this.code,
    };
  }
}
