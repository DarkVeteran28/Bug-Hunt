// The page side of a single-player game: owns the frame loop and connects
// rendering, physics, player control, vehicles, weapons, the debugger, menus
// and saving to one GameSession (engine/session.js), which decides the rules.
//
// Pausing stops the simulation: the engine clock, physics, enemies, respawn
// timers and play time all stand still until Resume.
import * as THREE from 'three';
import { WEAPONS } from '../../shared/config.js';
import { DISTRICTS, districtIndexAt, STATIONS, getWorld, VEHICLE_SPAWNS } from '../../shared/world-data.js';
import { buildSave } from '../../engine/save.js';
import { createScene } from './scene.js';
import { buildWorld } from './world.js';
import { createPhysics } from './physics.js';
import { CameraController } from './camera-controller.js';
import { PlayerController } from './player-controller.js';
import { VehicleController } from './vehicle-controller.js';
import { WeaponController } from './weapon-controller.js';
import { EnemyView } from './enemy-view.js';
import { PickupView } from './pickup-view.js';
import { EffectPool } from './effects.js';
import { createCharacter } from './character.js';
import { NpcManager } from './npc.js';
import { Minimap } from './minimap.js';
import { MissionView, GateController, StationDemos } from './mission-manager.js';
import { ChallengeUI } from './challenge-ui.js';
import { StatsPanel } from './stats-panel.js';
import { Hud, esc, formatTime } from './combat-ui.js';
import { input, initInput, on as onInput, releasePointer, requestPointer } from './input.js';
import { sfx, unlockAudio } from './audio.js';
import { settings, graphicsProfile, savedSettings } from './settings.js';
import { initLayout } from './layout.js';
import { registerChallenges, setVerifiedCode, setErrorHandler } from './challenge-runtime.js';
import { writeSave } from './save-store.js';
import { confirmDialog } from './dialog.js';

const STATION_RANGE = 3.6;
const AUTOSAVE_EVERY_MS = 60_000;

export class Game {
  /**
   * session      a GameSession (new or restored from a save)
   * playTimeMs   play time already on the save
   * menus        { openSettings(onBack), restart(), exitToMenu() } from main.js
   */
  constructor({ session, playTimeMs = 0, menus }) {
    this.session = session;
    this.menus = menus;
    this.hud = new Hud();
    this.playTimeMs = playTimeMs;
    this.paused = false;
    // The world waits for the first click into the game before it starts moving.
    this.started = false;
    this.debugOpen = null;
    this.lastDistrict = -1;
    this.frames = 0;
    this.fpsTime = 0;
    this.running = false;
    this.sinceAutosave = 0;
    this.autosaveTimer = null;
    this.saving = null;
    this.lastSavedAt = null;
    this.tmpFocus = new THREE.Vector3();
  }

  async init() {
    const s = this.session;
    const gfx = graphicsProfile();
    const host = document.getElementById('canvas-host');
    this.view = createScene(host);
    this.layout = initLayout(() => {
      this.view.resize();
      if (this.challengeUI) this.challengeUI.editor.layout();
    });
    this.physics = await createPhysics();
    this.world = buildWorld(this.view.scene, { shadows: gfx.shadows });
    this.camCtl = new CameraController(this.view.camera, this.physics);
    this.avatar = createCharacter({ color: '#ff4fa3', seed: 1, shadows: gfx.shadows });
    this.view.scene.add(this.avatar.root);
    this.player = new PlayerController(this.physics, this.camCtl, this.avatar);
    this.player.ry = s.player.ry;
    this.camCtl.yaw = s.player.ry + Math.PI;
    this.player.teleport(s.player.pos);
    this.vehicles = new VehicleController(this.view.scene, this.physics, { shadows: gfx.shadows });
    this.vehicles.setPoses(s.vehiclePoses);
    this.vehicles.onReset = (v, msg) => this.hud.toast(msg, 'warn', 6000);
    this.effects = new EffectPool(this.view.scene);
    this.weapons = new WeaponController({ camera: this.view.camera, camCtl: this.camCtl, physics: this.physics, session: s, hud: this.hud, effects: this.effects });
    this.enemyView = new EnemyView(this.view.scene, { shadows: false, detailRange: gfx.enemyDetailRange });
    this.weapons.onHit = (h) => this.enemyView.hit(h.id);
    this.pickupView = new PickupView(this.view.scene, s.pickupsView());
    this.npcs = new NpcManager(this.view.scene, { shadows: gfx.shadows });
    this.minimap = new Minimap(document.getElementById('minimap'));
    this.missionView = new MissionView({ world: this.world, hud: this.hud });
    this.gates = new GateController({ world: this.world, physics: this.physics });
    this.demos = new StationDemos({ hud: this.hud, gates: this.gates, weapons: this.weapons });
    this.stats = new StatsPanel({ session: s, playTime: () => this.playTimeMs });
    this.challenges = s.challengeList();
    registerChallenges(this.challenges);
    setErrorHandler((id, e) => {
      const c = this.challenges.find((x) => x.id === id);
      this.hud.toast(`${c ? c.title : id}: the game's copy of this function threw "${e && e.message}". Using a safe fallback.`, 'bad', 7000);
    });
    this.challengeUI = new ChallengeUI({
      session: s,
      hud: this.hud,
      onApplied: () => {},
      onOpenChanged: (open, id) => {
        this.debugOpen = open ? id : null;
      },
    });
    this.challengeUI.setChallenges(this.challenges);

    this.setProgress(s.progressView(), true);
    this.missionView.setMissions(s.missionsView());
    this.hud.setHealth(s.player.health);
    this.updateScore();

    initInput(host);
    onInput('tab', () => this.stats.toggle());
    onInput('escape', () => this.togglePause());
    onInput('lock-lost', () => this.pause());
    onInput('lock', (locked) => {
      if (locked && !this.started) {
        this.started = true;
        document.getElementById('click-to-play').textContent = 'Click the game to look around · Esc pauses';
      }
      this.hud.clickToPlay(!locked && !this.paused);
      if (locked) unlockAudio();
    });
    this.setupPauseMenu();
    this.bindSession();
    // Leaving or hiding the tab writes an autosave (IndexedDB usually finishes
    // in time; the 60-second autosave covers the rest).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.autosave('hidden');
    });
    window.addEventListener('pagehide', () => this.autosave('leaving'));
    this.hud.toast(s.clockMs > 0 ? `Game loaded. Play time ${formatTime(this.playTimeMs)}.` : 'New game. Find the glowing debugging station on the plaza and press E.', 'good', 6000);
  }

  // --- Pause menu -------------------------------------------------------------

  setupPauseMenu() {
    const $ = (id) => document.getElementById(id);
    $('btn-resume').addEventListener('click', () => this.resume());
    $('btn-menu').addEventListener('click', () => this.pause());
    $('btn-save').addEventListener('click', () => this.saveGame('manual', 'manual'));
    $('btn-pause-settings').addEventListener('click', () => {
      $('pause').hidden = true;
      this.menus.openSettings(() => {
        $('pause').hidden = false;
      });
    });
    $('btn-restart').addEventListener('click', async () => {
      const ok = await confirmDialog('Restart from the beginning? Your current game is not saved first. Saved games stay until you save over them.', { ok: 'Restart', danger: true });
      if (ok) this.menus.restart();
    });
    $('btn-exit').addEventListener('click', async () => {
      const ok = await confirmDialog('Exit to the main menu? The game is autosaved first.', { ok: 'Save and exit' });
      if (!ok) return;
      await this.autosave('exit', { force: true });
      this.menus.exitToMenu();
    });
  }

  togglePause() {
    if (this.paused) this.resume();
    else this.pause();
  }

  pause() {
    if (this.paused || !this.running || !this.started) return;
    this.paused = true;
    releasePointer();
    input.clear();
    this.challengeUI.saveDraftNow();
    this.stats.toggle(false);
    document.getElementById('pause').hidden = false;
    document.getElementById('pause-info').textContent = this.pauseInfo();
    this.hud.clickToPlay(false);
    sfx.setEngine(false);
  }

  resume() {
    if (!this.paused) return;
    for (const id of ['pause', 'settings']) document.getElementById(id).hidden = true;
    this.paused = false;
    // The world waits for the first click into the game before it starts moving.
    this.started = false;
    input.clear();
    requestPointer();
    if (this.vehicles.driving) sfx.setEngine(true, 0);
  }

  pauseInfo() {
    const st = this.session.statsView();
    const saved = this.lastSavedAt ? `Last saved ${new Date(this.lastSavedAt).toLocaleTimeString()}` : 'Not saved yet this session';
    return `Score ${st.totals.total.toLocaleString()} · Bugs ${st.bugsFixed}/${st.bugsTotal} · Chips ${st.chips}/${st.chipsTotal} · Play time ${formatTime(this.playTimeMs)} · ${saved}`;
  }

  // --- Saving -------------------------------------------------------------------

  buildSaveNow(label) {
    const s = this.session;
    this.challengeUI.saveDraftNow();
    s.vehiclePoses = this.vehicles.poses();
    // In a car, save the spot beside it so loading does not put you inside it.
    const p = s.player;
    const keep = p.lastValidPos;
    const d = this.vehicles.driving;
    if (d && p.alive) p.lastValidPos = [d.v.pos.x + Math.cos(d.v.ry) * 2.2, Math.max(0, d.v.pos.y), d.v.pos.z - Math.sin(d.v.ry) * 2.2];
    try {
      return buildSave(s, { playTimeMs: this.playTimeMs, settings: savedSettings(), label });
    } finally {
      p.lastValidPos = keep;
    }
  }

  /** slot: 'manual' | 'auto'. Returns true when the save was written. */
  async saveGame(slot, reason) {
    if (this.saving) await this.saving;
    const manual = slot === 'manual';
    const run = (async () => {
      try {
        const save = this.buildSaveNow(manual ? 'Saved game' : `Autosave (${reason})`);
        await writeSave(slot, save);
        this.lastSavedAt = save.savedAt;
        this.sinceAutosave = 0;
        this.hud.saveStatus(`${manual ? 'Saved' : 'Autosaved'} ${new Date(save.savedAt).toLocaleTimeString()}`);
        if (manual) {
          this.hud.toast('Game saved.', 'good');
          sfx.click();
          document.getElementById('pause-info').textContent = this.pauseInfo();
        }
        return true;
      } catch (e) {
        console.error(e);
        this.hud.toast(`Could not save: ${e.message}`, 'bad', 7000);
        this.hud.saveStatus('Save failed');
        return false;
      }
    })();
    this.saving = run;
    const ok = await run;
    this.saving = null;
    return ok;
  }

  autosave(reason, { force = false } = {}) {
    if (!this.running) return Promise.resolve(false);
    if (!force && !this.session.player.alive) return Promise.resolve(false);
    return this.saveGame('auto', reason);
  }

  scheduleAutosave(reason) {
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => this.autosave(reason), 1500);
  }

  // --- Engine events ------------------------------------------------------------

  setProgress(p, firstTime = false) {
    const prevWeapons = this.progress ? this.progress.weapons : null;
    const prevDistricts = this.progress ? this.progress.districts : null;
    this.progress = p;
    setVerifiedCode(p.code);
    this.challengeUI.setProgress(p);
    this.missionView.setProgress(p);
    this.gates.setUnlocked(p.gates);
    this.weapons.refresh();
    for (const st of STATIONS) {
      const c = this.challenges.find((x) => x.id === st.challengeId);
      this.world.setStationState(st.challengeId, p.solved.includes(st.challengeId) ? 'solved' : p.districts.includes(c.district) ? 'open' : 'locked');
    }
    this.hud.bottomBar({ bugs: `${p.solved.length}/${this.challenges.length}` });
    if (!firstTime) {
      for (const w of p.weapons) if (!prevWeapons.includes(w)) this.hud.popup(`${WEAPONS[w].name.toUpperCase()} UNLOCKED`, `Press ${WEAPONS[w].slot} to equip`, 'mission');
      for (const d of p.districts) if (!prevDistricts.includes(d)) {
        const name = DISTRICTS.find((x) => x.id === d).name;
        this.hud.popup(`${name.toUpperCase()} UNLOCKED`, 'The gate is opening', 'mission');
        sfx.mission();
      }
    }
  }

  updateScore() {
    const st = this.session.statsView();
    this.hud.topBar({ score: st.totals.total, chips: `${st.chips}/${st.chipsTotal}` });
    this.hud.bottomBar({ kills: st.kills, deaths: st.deaths });
  }

  bindSession() {
    const s = this.session;
    s.on('ammo', () => this.weapons.refresh());
    s.on('progress', (p) => this.setProgress(p));
    s.on('missions', (m) => this.missionView.setMissions(m));
    s.on('score', () => this.updateScore());
    s.on('autosave', (why) => this.scheduleAutosave(why));
    s.on('pickup', (e) => {
      if (e.kind === 'chip') {
        this.hud.popup('DATA CHIP', `+${e.points} · ${e.count} of ${e.total} collected`, 'bug');
        sfx.success();
      } else if (e.kind === 'medkit') {
        this.hud.setHealth(e.health);
        this.hud.toast(`Med kit: health ${e.health}.`, 'good');
        sfx.click();
      } else if (e.kind === 'ammo') {
        this.hud.toast('Ammo crate: reserve ammo refilled.', 'good');
        sfx.reload();
      }
    });
    s.on('kill', (k) => {
      this.hud.killFeed(k);
      if (k.mine && k.points) this.hud.popup('GLITCH BOT DOWN', `+${k.points} COMBAT POINTS`, 'combat');
    });
    s.on('enemy-shot', (e) => {
      const from = new THREE.Vector3(...e.from);
      this.effects.tracer(from, new THREE.Vector3(...e.to), '#ff6b6b', 0.1);
      sfx.shot('pistol', from.distanceTo(this.view.camera.position));
    });
    s.on('damaged', (d) => {
      this.hud.setHealth(d.health);
      sfx.hurt();
      const me = this.player.position;
      const angle = Math.atan2(d.from[0] - me.x, d.from[2] - me.z);
      const camYaw = Math.atan2(-Math.sin(this.camCtl.yaw), -Math.cos(this.camCtl.yaw));
      this.hud.damage(camYaw - angle);
    });
    s.on('player-down', (e) => {
      this.hud.setHealth(0);
      if (this.vehicles.driving) this.leaveCar();
      this.hud.showDeath(e.by ? `Taken down by ${e.by}` : 'You went down.', () => Math.max(0, s.player.respawnAt - s.clockMs));
    });
    s.on('respawn', (m) => {
      if (this.vehicles.driving) this.leaveCar();
      this.player.teleport(m.p);
      this.hud.setHealth(m.health);
      this.hud.hideDeath();
      this.weapons.refresh();
      if (m.reason === 'fell') this.hud.toast('You fell out of the city. Respawned.', 'warn');
    });
    s.on('mission', (e) => {
      if (e.type === 'mission-complete') {
        this.hud.popup(`MISSION COMPLETE: ${e.title.toUpperCase()}`, e.reward ? `+${e.reward} MISSION POINTS` : 'Already rewarded', 'mission');
        sfx.mission();
      } else if (e.type === 'city-cleared') {
        this.hud.popup('VICE CITY CLEARED', `+${e.reward} BONUS`, 'bug');
      } else if (e.type === 'mission-step') {
        sfx.click();
        this.hud.toast('Mission updated.', 'good');
      } else if (e.type === 'npc-say') {
        this.hud.toast(`${e.npc}: "${e.message}"`, 'npc', 6000);
      } else if (e.type === 'mission-blocked') {
        this.hud.toast(e.message, 'warn', 6000);
      } else if (e.type === 'error') {
        this.hud.toast(e.message, 'warn');
      }
    });
  }

  // --- Interactions -------------------------------------------------------------

  nearestStation(pos) {
    let best = null;
    let bestD = STATION_RANGE;
    for (const st of STATIONS) {
      const d = Math.hypot(st.pos[0] - pos.x, st.pos[2] - pos.z);
      if (d < bestD) {
        bestD = d;
        best = st;
      }
    }
    return best;
  }

  nearestGatePanel(pos) {
    for (const g of getWorld().gates) {
      if (Math.hypot(g.panel[0] - pos.x, g.panel[2] - pos.z) < 3) return g;
    }
    return null;
  }

  interactions(pos) {
    const driving = this.vehicles.driving;
    if (driving) {
      this.hud.prompt(`<kbd>E</kbd> Exit ${esc(driving.v.spec.name)}`);
      if (input.consume('KeyE')) this.leaveCar();
      return;
    }
    if (!this.session.player.alive) {
      this.hud.prompt(null);
      return;
    }
    const st = this.nearestStation(pos);
    if (st) {
      const c = this.challenges.find((x) => x.id === st.challengeId);
      const solved = this.progress.solved.includes(c.id);
      const demo = this.demos.describe(c.id);
      const isOpen = this.debugOpen === c.id;
      this.hud.prompt(`${isOpen ? 'Debugging' : `<kbd>E</kbd> ${solved ? 'Review' : 'Debug'}`} <b>${esc(c.title)}</b> (${c.reward} pts)${this.demos.hasDemo(c.id) ? ` · <kbd>F</kbd> ${esc(demo)}` : ` · <span class="muted">${esc(demo)}</span>`}`);
      if (input.consume('KeyE') && !isOpen) {
        // Free the mouse for the debugger (this is not a pause: the safe-debugging shield covers you).
        releasePointer();
        input.clear();
        this.layout.showDebugger();
        this.challengeUI.open(c.id);
      }
      if (input.consume('KeyF') && this.demos.hasDemo(c.id)) this.demos.run(c.id, this.progress);
      return;
    }
    const gate = this.nearestGatePanel(pos);
    if (gate) {
      const open = this.progress.gates.includes(gate.id);
      const c = this.challenges.find((x) => x.id === gate.requiresChallenge);
      if (gate.id === 'gate-downtown' && !open) {
        this.hud.prompt(`<kbd>E</kbd> Run gate test cycle · locked until <b>${esc(c.title)}</b> is fixed`);
        if (input.consume('KeyE')) this.demos.run('invisible-gate', this.progress);
      } else {
        this.hud.prompt(open ? `${esc(gate.name)}: open` : `${esc(gate.name)} is locked. Fix <b>${esc(c.title)}</b> to open it.`);
      }
      return;
    }
    const npc = this.npcs.nearestMissionNpc(pos);
    if (npc) {
      this.hud.prompt(`<kbd>E</kbd> Talk to ${esc(npc.name)}`);
      if (input.consume('KeyE')) this.session.talk(npc.id);
      return;
    }
    const v = this.vehicles.nearest(pos);
    if (v) {
      this.hud.prompt(`<kbd>E</kbd> Enter ${esc(v.spec.name)}`);
      if (input.consume('KeyE')) this.enterCar(v);
      return;
    }
    this.hud.prompt(null);
  }

  enterCar(v) {
    const r = this.session.enterVehicle({ id: v.id, pos: [v.pos.x, v.pos.y, v.pos.z], driver: null });
    if (!r.ok) {
      this.hud.toast(r.error || 'Could not enter the car.', 'warn');
      sfx.empty();
      return;
    }
    this.vehicles.startDriving(v.id);
    this.avatar.setVisible(false);
    sfx.door();
  }

  leaveCar() {
    const v = this.vehicles.stopDriving();
    this.session.exitVehicle();
    this.avatar.setVisible(true);
    this.hud.vehicle(null);
    if (!v) return;
    this.player.teleport([v.pos.x + Math.cos(v.ry) * 2.2, Math.max(0, v.pos.y), v.pos.z - Math.sin(v.ry) * 2.2]);
  }

  // --- Frame loop -------------------------------------------------------------------

  start() {
    this.running = true;
    let last = performance.now();
    const frame = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      try {
        this.tick(dt);
      } catch (e) {
        console.error(e);
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  stop() {
    this.running = false;
  }

  /** Move the simulation forward one frame (skipped while paused). */
  simulate(dt) {
    const s = this.session;
    this.playTimeMs += dt * 1000;
    const [mx, my] = input.mouseDelta();
    if (input.locked) this.camCtl.look(mx, my);
    const alive = s.player.alive;
    this.camCtl.aiming = input.aimDown && alive && !this.vehicles.driving;

    const driving = this.vehicles.driving;
    const focus = this.tmpFocus;
    let speed = 0;
    if (driving) {
      const pose = this.vehicles.drive(dt);
      focus.set(pose.x, pose.y, pose.z);
      speed = pose.speed;
      this.physics.teleportPlayer(pose.x, -40, pose.z); // keep the hidden body with the car
    } else {
      const p = this.player.update(dt, { frozen: !alive });
      focus.set(p.x, p.y, p.z);
      speed = this.player.speed;
    }
    this.gates.update(dt);
    this.physics.step(dt);
    this.vehicles.update(dt);

    s.update(dt);
    if (s.player.alive) {
      const r = s.setPosition([focus.x, focus.y, focus.z], { ry: driving ? driving.v.ry : this.player.ry, speed });
      if (r.correction) {
        if (driving) {
          const v = driving.v;
          v.pos.set(...r.correction);
          this.physics.setCar(true, r.correction[0], r.correction[1], r.correction[2]);
          driving.state.position = { x: r.correction[0], y: r.correction[1], z: r.correction[2] };
          driving.state.speed = 0;
        } else this.player.teleport(r.correction);
        focus.set(...r.correction);
      }
    }
    this.hud.vehicle(this.vehicles.driving ? { name: this.vehicles.driving.v.spec.name, speed } : null);

    const canFire = alive && !driving && input.locked && !s.isShielded();
    this.weapons.update(dt, { playerPos: focus, canFire, boxes: this.enemyView.boxes() });
    this.npcs.update(dt, focus);
    this.demos.update();
    this.interactions(focus);

    this.sinceAutosave += dt * 1000;
    if (this.sinceAutosave >= AUTOSAVE_EVERY_MS) {
      this.sinceAutosave = 0;
      this.autosave('timer');
    }
    return focus;
  }

  tick(dt) {
    const s = this.session;
    let focus;
    const live = !this.paused && this.started;
    if (live) focus = this.simulate(dt);
    else {
      input.mouseDelta();
      const d = this.vehicles.driving;
      focus = this.tmpFocus;
      if (d) focus.copy(d.v.pos);
      else {
        const p = this.player.position;
        focus.set(p.x, p.y, p.z);
      }
    }
    const simDt = live ? dt : 0;
    const driving = this.vehicles.driving;
    const alive = s.player.alive;

    if (!driving) {
      this.avatar.root.position.copy(focus);
      this.avatar.root.rotation.y = this.player.ry;
      this.avatar.setAim(this.camCtl.pitch);
      this.avatar.setWeapon(s.player.equipped);
      this.avatar.animate(simDt, alive ? this.player.anim : 'dead');
      const shielded = s.isShielded();
      const protectedNow = s.player.spawnProtectedUntil > s.clockMs;
      this.avatar.setShield(shielded || protectedNow, shielded ? '#4fe3ff' : '#ffd23f');
      this.hud.shield(shielded);
    }
    this.camCtl.update(dt, focus, { inVehicle: !!driving });
    this.enemyView.update(simDt, s.enemiesView(), s.clockMs, this.view.camera.position);
    this.pickupView.update(simDt, s.pickupsView());
    this.effects.update(simDt);
    const target = this.missionView.update(focus);
    this.world.update(simDt);
    this.view.update(simDt, focus);

    const di = districtIndexAt(focus.x);
    if (di !== this.lastDistrict) {
      if (this.lastDistrict !== -1) this.hud.toast(`Entering ${DISTRICTS[di].name}`, '');
      this.lastDistrict = di;
      this.hud.bottomBar({ district: DISTRICTS[di].name });
    }
    if (this.player.inHotel && !driving && !this.hotelWarned) {
      this.hotelWarned = true;
      this.hud.toast('You walked straight through the Sunset Hotel wall. That is the Ghost Wall bug: debug it at the station on the plaza.', 'warn', 7000);
    }
    if (!this.player.inHotel) this.hotelWarned = false;
    this.hud.crosshair({ visible: !driving && alive && !this.paused, aiming: this.camCtl.aiming });
    this.hud.topBar({ playTime: this.playTimeMs });
    if (this.stats.open && (this.frameCount = (this.frameCount || 0) + 1) % 30 === 0) this.stats.render();

    this.frameMinimap = (this.frameMinimap || 0) + 1;
    if (this.frameMinimap % 3 === 0) {
      const stationStates = Object.fromEntries(STATIONS.map((st) => {
        const c = this.challenges.find((x) => x.id === st.challengeId);
        return [st.challengeId, this.progress.solved.includes(st.challengeId) ? 'solved' : this.progress.districts.includes(c.district) ? 'open' : 'locked'];
      }));
      this.minimap.draw({
        me: focus,
        yaw: this.camCtl.yaw,
        players: [...this.pickupView.minimapDots(s.pickupsView()), ...this.enemyView.minimapDots()],
        vehicles: this.vehicles.vehicles.map((v) => ({ x: v.pos.x, z: v.pos.z, color: VEHICLE_SPAWNS[v.index].color })),
        gatesOpen: this.progress.gates,
        stationStates,
        target,
      });
    }

    this.view.renderer.render(this.view.scene, this.view.camera);
    input.endFrame();

    this.frames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      const info = this.view.renderer.info;
      this.hud.fps(settings.showFps ? `${Math.round(this.frames / this.fpsTime)} FPS · ${info.render.calls} draws · ${info.memory.geometries} geometries` : null);
      this.lastFps = Math.round(this.frames / this.fpsTime);
      this.frames = 0;
      this.fpsTime = 0;
    }
  }
}

