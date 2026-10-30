// Missions. Progress advances from the player's accepted position (locked
// districts are refused first) and from talking to mission NPCs.
import { MISSIONS, MISSION_NPCS, dist2D } from '../shared/world-data.js';
import { rule, transition } from './game-logic.js';
import { SCORING } from '../shared/config.js';

const TALK_RANGE = 4;
const CHECKPOINT_HEIGHT = 6;

export function freshMissionState() {
  return Object.fromEntries(MISSIONS.map((m) => [m.id, { step: 0, courier: 'idle' }]));
}

export class MissionManager {
  constructor(db) {
    this.db = db;
  }

  view(player) {
    return MISSIONS.map((m) => {
      const done = player.progress.missions.has(m.id);
      const st = player.missionState[m.id];
      return {
        id: m.id,
        title: m.title,
        district: m.district,
        summary: m.summary,
        done,
        step: done ? m.steps.length : st.step,
        steps: m.steps.map((s) => s.label),
        courier: m.id === 'm-downtown' ? st.courier : undefined,
        reward: m.reward,
      };
    });
  }

  available(player, m) {
    return !player.progress.missions.has(m.id) && player.progress.districtUnlocked(m.district);
  }

  /** Called after a position update has been accepted. Returns events. */
  onPosition(player) {
    const events = [];
    for (const m of MISSIONS) {
      if (!this.available(player, m)) continue;
      const st = player.missionState[m.id];
      const step = m.steps[st.step];
      if (!step) continue;
      let reached = false;
      if (step.type === 'reach') {
        reached = dist2D(player.pos, step.pos) <= step.radius && (!step.inVehicle || !!player.vehicleId);
      } else if (step.type === 'checkpoint') {
        const pos = { x: player.pos[0], y: player.pos[1], z: player.pos[2] };
        const cp = { center: { x: step.pos[0], y: step.pos[1], z: step.pos[2] }, radius: step.radius, height: CHECKPOINT_HEIGHT };
        reached = rule('faulty-checkpoint', player.progress.isSolved('faulty-checkpoint'), pos, cp);
        if (!reached && dist2D(player.pos, step.pos) <= step.radius && !player.progress.isSolved('faulty-checkpoint')) {
          // Tell the player the checkpoint is visibly broken (at most every 4 s).
          const t = Date.now();
          if (!st.lastBrokenNotice || t - st.lastBrokenNotice > 4000) {
            st.lastBrokenNotice = t;
            events.push({ type: 'mission-blocked', missionId: m.id, message: 'The checkpoint ring flickers but does not register you. Its detector is bugged (Faulty Checkpoint).' });
          }
        }
      }
      if (reached) events.push(...this.advance(player, m));
    }
    return events;
  }

  /** Player pressed E near a mission NPC. */
  talk(player, npcId) {
    const npc = MISSION_NPCS.find((n) => n.id === npcId);
    if (!npc || !player.alive) return [{ type: 'error', message: 'Nobody to talk to.' }];
    if (dist2D(player.pos, npc.pos) > TALK_RANGE) return [{ type: 'error', message: `Get closer to ${npc.name}.` }];
    const m = MISSIONS.find((x) => x.id === 'm-downtown');
    if (!this.available(player, m)) return [{ type: 'npc-say', npc: npc.name, message: player.progress.missions.has(m.id) ? 'Thanks again for the delivery!' : 'Not now.' }];
    const st = player.missionState[m.id];
    const solved = player.progress.isSolved('broken-mission');
    if (npc.id === 'npc-rico') {
      if (st.courier === 'idle') st.courier = transition('broken-mission', solved, st.courier, { type: 'accept' });
      if (st.courier === 'pickup') st.courier = transition('broken-mission', solved, st.courier, { type: 'pickup' });
      if (st.courier === 'delivering') {
        st.step = 1;
        return [{ type: 'npc-say', npc: npc.name, message: 'Take this package to Vera, across Downtown. Do not open it.' }, { type: 'mission-step', missionId: m.id, step: 1 }];
      }
      return [{ type: 'npc-say', npc: npc.name, message: 'Come back when you are ready.' }];
    }
    if (npc.id === 'npc-vera') {
      if (st.courier !== 'delivering') return [{ type: 'npc-say', npc: npc.name, message: 'Rico has something for me. Go see him first.' }];
      const next = transition('broken-mission', solved, st.courier, { type: 'deliver', npc: 'npc-vera' });
      st.courier = next;
      if (next === 'complete') {
        return [{ type: 'npc-say', npc: npc.name, message: 'Perfect. Pleasure doing business.' }, ...this.advance(player, m)];
      }
      return [
        { type: 'npc-say', npc: npc.name, message: 'Hand it over... huh, your courier app still says "delivering".' },
        { type: 'mission-blocked', missionId: m.id, message: 'The mission state machine did not complete. Fix the Broken Mission challenge.' },
      ];
    }
    return [];
  }

  advance(player, m) {
    const st = player.missionState[m.id];
    st.step += 1;
    if (st.step < m.steps.length) return [{ type: 'mission-step', missionId: m.id, step: st.step }];
    const paid = this.db.completeMission(player.id, m.id, m.reward);
    player.progress.missions.add(m.id);
    player.progress.recompute();
    const events = [{ type: 'mission-complete', missionId: m.id, title: m.title, reward: paid ? m.reward : 0 }];
    if (paid) player.session.otherPoints += m.reward;
    if (m.id === 'm-industrial' && this.db.award(player.id, 'bonus', 'city-cleared', SCORING.cityCleared)) {
      player.session.otherPoints += SCORING.cityCleared;
      events.push({ type: 'city-cleared', reward: SCORING.cityCleared });
    }
    return events;
  }
}
