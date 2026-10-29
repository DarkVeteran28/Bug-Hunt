// Game orchestration: owns the frame loop and connects rendering, physics,
// player control, vehicles, weapons, networking, missions and the debugger.
import * as THREE from 'three';
import { WEAPONS, NET, PLAYER } from '/shared/config.js';
import { DISTRICTS, districtIndexAt, STATIONS, getWorld, VEHICLE_SPAWNS } from '/shared/world-data.js';
import { createScene } from './scene.js';
import { buildWorld } from './world.js';
import { createPhysics } from './physics.js';
import { CameraController } from './camera-controller.js';
import { PlayerController } from './player-controller.js';
import { VehicleController } from './vehicle-controller.js';
import { WeaponController } from './weapon-controller.js';
import { createCharacter } from './character.js';
import { NpcManager } from './npc.js';
import { Minimap } from './minimap.js';
import { MissionView, GateController, StationDemos } from './mission-manager.js';
import { ChallengeUI } from './challenge-ui.js';
import { Leaderboard } from './leaderboard.js';
import { Hud, esc } from './combat-ui.js';
import { RemoteState, INTERP_DELAY } from './multiplayer.js';
import { input, initInput, on as onInput, releasePointer } from './input.js';
import { sfx, unlockAudio } from './audio.js';
import { settings, saveSettings, onSettings } from './settings.js';
import { initLayout } from './layout.js';
import { registerChallenges, setVerifiedCode, setErrorHandler } from './challenge-runtime.js';

const WEAPON_IDS = Object.keys(WEAPONS);
const ANIMS = ['idle', 'walk', 'run', 'jump', 'drive'];
const STATION_RANGE = 3.6;

export class Game {
  constructor(net, welcome) {
    this.net = net;
    this.welcome = welcome;
    this.hud = new Hud();
    this.remotes = new Map();
    this.rosterById = new Map();
    this.progress = null;
    this.alive = true;
    this.health = PLAYER.maxHealth;
    this.debugOpen = null;
    this.shielded = false;
    this.spawnProtected = false;
    this.lastSend = 0;
    this.lastDistrict = -1;
    this.room = null;
    this.roundEndsAt = null;
    this.frames = 0;
    this.fpsTime = 0;
    this.running = false;
  }

  async init() {
    const host = document.getElementById('canvas-host');
    this.view = createScene(host);
    this.layout = initLayout(() => {
      this.view.resize();
      if (this.challengeUI) this.challengeUI.editor.layout();
    });
    this.physics = await createPhysics();
    this.world = buildWorld(this.view.scene, { graphics: settings.graphics });
    this.camCtl = new CameraController(this.view.camera, this.physics);
    this.avatar = createCharacter({ color: '#ff4fa3', seed: this.welcome.id, shadows: settings.graphics === 'high' });
    this.view.scene.add(this.avatar.root);
    this.player = new PlayerController(this.physics, this.camCtl, this.avatar);
    this.vehicles = new VehicleController(this.view.scene, this.physics, { shadows: settings.graphics === 'high' });
    this.vehicles.onReset = (v, msg) => {
      this.hud.toast(msg, 'warn', 6000);
      this.sendState(true);
    };
    this.weapons = new WeaponController({ scene: this.view.scene, camera: this.view.camera, camCtl: this.camCtl, physics: this.physics, net: this.net, hud: this.hud });
    this.npcs = new NpcManager(this.view.scene, { shadows: settings.graphics === 'high' });
    this.minimap = new Minimap(document.getElementById('minimap'));
    this.missionView = new MissionView({ world: this.world, hud: this.hud });
    this.gates = new GateController({ world: this.world, physics: this.physics });
    this.demos = new StationDemos({ hud: this.hud, gates: this.gates, weapons: this.weapons });
    this.leaderboard = new Leaderboard({ net: this.net });
    this.leaderboard.myId = this.welcome.id;
    this.hud.myId = this.welcome.id;
    registerChallenges(this.welcome.challenges);
    setErrorHandler((id, e) => {
      const c = this.welcome.challenges.find((x) => x.id === id);
      this.hud.toast(`${c ? c.title : id}: the game's copy of this function threw "${e && e.message}". Using a safe fallback.`, 'bad', 7000);
    });
    this.challengeUI = new ChallengeUI({
      net: this.net,
      hud: this.hud,
      onApplied: () => {},
      onOpenChanged: (open, id) => {
        this.debugOpen = open ? id : null;
      },
    });
    this.challengeUI.setChallenges(this.welcome.challenges);

    initInput(host);
    onInput('tab', () => this.leaderboard.toggle());
    onInput('escape', () => this.toggleMenu());
    onInput('lock-lost', () => this.toggleMenu(true));
    onInput('lock', (locked) => {
      this.hud.clickToPlay(!locked);
      if (locked) unlockAudio();
    });
    this.setupMenu();
    this.bindNetwork();
    window.addEventListener('beforeunload', () => this.challengeUI.saveDraftNow());
  }

  setupMenu() {
    const $ = (id) => document.getElementById(id);
    const sync = () => {
      $('set-sens').value = settings.sensitivity;
      $('sens-val').textContent = Number(settings.sensitivity).toFixed(1);
      $('set-invert').checked = settings.invertY;
      $('set-vol').value = settings.volume;
      $('vol-val').textContent = `${Math.round(settings.volume * 100)}%`;
      $('set-mute').checked = settings.muted;
      $('set-gfx').value = settings.graphics;
      $('set-light').value = settings.lighting;
      $('set-fps').checked = settings.showFps;
    };
    sync();
    $('set-sens').addEventListener('input', (e) => saveSettings({ sensitivity: Number(e.target.value) }));
    $('set-invert').addEventListener('change', (e) => saveSettings({ invertY: e.target.checked }));
    $('set-vol').addEventListener('input', (e) => saveSettings({ volume: Number(e.target.value) }));
    $('set-mute').addEventListener('change', (e) => saveSettings({ muted: e.target.checked }));
    $('set-gfx').addEventListener('change', (e) => {
      saveSettings({ graphics: e.target.value });
      this.hud.toast('Graphics setting saved. It applies fully after a page reload.', '', 5000);
    });
    $('set-light').addEventListener('change', (e) => saveSettings({ lighting: e.target.value }));
    $('set-fps').addEventListener('change', (e) => saveSettings({ showFps: e.target.checked }));
    onSettings(sync);
    $('btn-resume').addEventListener('click', () => this.toggleMenu(false));
    $('btn-menu').addEventListener('click', () => this.toggleMenu(true));
    $('btn-leave').addEventListener('click', () => {
      this.challengeUI.saveDraftNow();
      this.net.leave();
      location.reload();
    });
  }

  toggleMenu(force) {
    const menu = document.getElementById('menu');
    const show = force === undefined ? menu.hidden : force;
    menu.hidden = !show;
    if (show) releasePointer();
  }

  // --- Networking ---------------------------------------------------------

  async join(options) {
    const r = await this.net.join(options);
    if (!r || !r.ok) throw new Error((r && r.error) || 'Could not join the room.');
    this.applyJoin(r);
    return r;
  }

  applyJoin(r) {
    this.room = r.room;
    this.hud.topBar({ name: r.you.name, room: r.room.isPublic ? r.room.modeName : r.room.code });
    document.getElementById('menu-room').textContent = r.room.code;
    document.getElementById('menu-mode').textContent = r.room.modeName;
    document.getElementById('menu-pvp').textContent = r.room.pvp ? 'on' : 'off';
    this.roundEndsAt = r.room.roundEndsAt;
    this.setProgress(r.progress);
    this.missionView.setMissions(r.missions);
    for (const a of r.loadout) this.weapons.setAmmo(a);
    this.weapons.equipped = r.you.equipped;
    this.weapons.setOwned(r.progress.weapons);
    this.setRoster(r.roster);
    this.health = r.you.health;
    this.alive = r.you.alive;
    this.hud.setHealth(this.health);
    if (!r.resumed || !this.positionKnown) {
      this.player.teleport(r.you.pos);
      this.positionKnown = true;
    }
    if (!r.you.vehicleId && this.vehicles.driving) this.vehicles.stopDriving();
    for (const k of r.killFeed) this.hud.killFeed(k);
    this.hud.toast(r.resumed ? 'Reconnected. Your state was restored.' : `Joined ${r.room.modeName}${r.room.isPublic ? '' : ` · room code ${r.room.code}`}`, 'good');
  }

  setProgress(p) {
    const firstTime = !this.progress;
    const prevWeapons = this.progress ? this.progress.weapons : null;
    const prevDistricts = this.progress ? this.progress.districts : null;
    this.progress = p;
    setVerifiedCode(p.code);
    this.challengeUI.setProgress(p);
    this.missionView.setProgress(p);
    this.gates.setUnlocked(p.gates);
    this.weapons.setOwned(p.weapons);
    for (const st of STATIONS) {
      const c = this.welcome.challenges.find((x) => x.id === st.challengeId);
      this.world.setStationState(st.challengeId, p.solved.includes(st.challengeId) ? 'solved' : p.districts.includes(c.district) ? 'open' : 'locked');
    }
    this.hud.bottomBar({ bugs: `${p.solved.length}/${this.welcome.challenges.length}` });
    if (!firstTime) {
      for (const w of p.weapons) if (!prevWeapons.includes(w)) this.hud.popup(`${WEAPONS[w].name.toUpperCase()} UNLOCKED`, `Press ${WEAPONS[w].slot} to equip`, 'mission');
      for (const d of p.districts) if (!prevDistricts.includes(d)) {
        const name = DISTRICTS.find((x) => x.id === d).name;
        this.hud.popup(`${name.toUpperCase()} UNLOCKED`, 'The gate is opening', 'mission');
        sfx.mission();
      }
    }
  }

  setRoster(list) {
    this.rosterById = new Map(list.map((r) => [r.id, r]));
    this.leaderboard.setRoster(list);
    const me = this.rosterById.get(this.welcome.id);
    if (me) {
      this.hud.bottomBar({ kills: me.kills, deaths: me.deaths });
      this.avatar.root.userData.color = me.color;
    }
    for (const r of list) {
      if (r.id === this.welcome.id) continue;
      const rem = this.remotes.get(r.id);
      if (rem && !rem.ch) this.attachCharacter(rem, r);
    }
    for (const [id, rem] of this.remotes) {
      if (!this.rosterById.has(id)) this.removeRemote(id);
      else if (rem.ch) rem.ch.root.visible = this.rosterById.get(id).connected;
    }
  }

  attachCharacter(rem, info) {
    rem.ch = createCharacter({ color: info.color, name: info.name, seed: info.id, shadows: false });
    this.view.scene.add(rem.ch.root);
  }

  removeRemote(id) {
    const rem = this.remotes.get(id);
    if (!rem) return;
    if (rem.ch) {
      this.view.scene.remove(rem.ch.root);
      rem.ch.dispose();
    }
    this.remotes.delete(id);
  }

  bindNetwork() {
    const n = this.net;
    n.on('s', (snap) => this.onSnapshot(snap));
    n.on('correction', (m) => {
      if (this.vehicles.driving) {
        const v = this.vehicles.driving.v;
        v.pos.set(...m.p);
        this.physics.setCar(true, m.p[0], m.p[1], m.p[2]);
        this.vehicles.driving.state.position = { x: m.p[0], y: m.p[1], z: m.p[2] };
        this.vehicles.driving.state.speed = 0;
      } else this.player.teleport(m.p);
      if (m.reason === 'locked') this.hud.toast('That area is locked for you. Fix the district\'s gate bug first.', 'warn');
    });
    n.on('respawn', (m) => {
      if (this.vehicles.driving) this.vehicles.stopDriving();
      this.player.teleport(m.p);
      this.alive = true;
      this.health = m.health || PLAYER.maxHealth;
      this.hud.setHealth(this.health);
      this.hud.hideDeath();
      if (m.loadout) for (const a of m.loadout) this.weapons.setAmmo(a);
      if (m.reason === 'fell') this.hud.toast('You fell out of the city. Respawned.', 'warn');
    });
    n.on('ammo', (a) => this.weapons.setAmmo(a));
    n.on('fire-rejected', (m) => {
      if (m.ammo) this.weapons.setAmmo(m.ammo);
      if (m.reason === 'debugging') this.hud.toast('Weapons are holstered while your safe-debugging shield is up.', 'warn');
    });
    n.on('shot', (s) => {
      if (s.id === this.welcome.id) return;
      this.weapons.remoteShot(s, this.view.camera.position);
    });
    n.on('hit-confirm', (h) => {
      this.hud.hitMarker(h.killed);
      if (h.killed) sfx.kill();
      else sfx.hit();
    });
    n.on('damaged', (d) => {
      this.health = d.health;
      this.hud.setHealth(d.health);
      sfx.hurt();
      const me = this.player.position;
      const angle = Math.atan2(d.from[0] - me.x, d.from[2] - me.z);
      const camYaw = Math.atan2(-Math.sin(this.camCtl.yaw), -Math.cos(this.camCtl.yaw));
      this.hud.damage(camYaw - angle);
    });
    n.on('kill', (k) => {
      this.hud.killFeed(k);
      if (k.victim === this.welcome.id) {
        this.alive = false;
        this.health = 0;
        this.hud.setHealth(0);
        if (this.vehicles.driving) this.vehicles.stopDriving();
        this.hud.showDeath(k.killer === k.victim ? 'You took yourself out.' : `Eliminated by ${k.killerName}`, performance.now() + PLAYER.respawnDelayMs);
      }
      if (k.killer === this.welcome.id && k.victim !== k.killer) {
        if (k.points) this.hud.popup('ELIMINATION CONFIRMED', `+${k.points} COMBAT POINTS`, 'combat');
        else if (k.farmed) this.hud.toast('No points: you already farmed this player recently.', 'warn');
      }
    });
    n.on('progress', (p) => this.setProgress(p));
    n.on('missions', (m) => this.missionView.setMissions(m));
    n.on('score', (s) => {
      this.hud.topBar({ score: s.totals.total, rank: s.rank });
    });
    n.on('roster', (r) => this.setRoster(r));
    n.on('player-joined', (p) => {
      if (p.id !== this.welcome.id) this.hud.toast(`${p.name} joined`, '');
    });
    n.on('player-left', (p) => {
      this.hud.toast(`${p.name} left`, '');
      this.removeRemote(p.id);
    });
    n.on('mission', (e) => {
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
    n.on('announce', (a) => this.hud.toast(a.text, 'good'));
    n.on('round-end', (r) => {
      this.hud.popup('ROUND OVER', r.winner ? `${r.winner.name} wins (+${r.reward})` : 'No winner this round', 'mission');
    });
    n.on('room-info', (info) => {
      this.room = info;
      this.roundEndsAt = info.roundEndsAt;
    });
    n.on('kicked', (k) => {
      this.running = false;
      document.getElementById('fatal-text').textContent = k.reason;
      document.getElementById('fatal').hidden = false;
    });
    n.onLocal('net', (s) => this.hud.netStatus(s.connected));
    n.onLocal('rejoined', (r) => {
      if (r && r.ok) this.applyJoin(r);
      else this.hud.toast('Could not rejoin the room after reconnecting.', 'bad');
    });
  }

  onSnapshot(snap) {
    for (const e of snap.p) {
      const [id, x, y, z, ry, pitch, flags, anim, weaponIdx, vehicleIdx, hp] = e;
      if (id === this.welcome.id) {
        this.shielded = !!(flags & 2);
        this.spawnProtected = !!(flags & 4);
        continue;
      }
      let rem = this.remotes.get(id);
      if (!rem) {
        rem = { id, state: new RemoteState(), ch: null };
        this.remotes.set(id, rem);
        const info = this.rosterById.get(id);
        if (info) this.attachCharacter(rem, info);
      }
      rem.state.push(snap.t, x, y, z);
      Object.assign(rem, { ry, pitch, flags, anim: ANIMS[anim] || 'idle', weapon: WEAPON_IDS[weaponIdx] || 'pistol', vehicleIdx, hp, lastSeen: performance.now() });
    }
    this.vehicles.applySnapshot(snap.v, this.welcome.id);
  }

  sendState(force = false) {
    const now = performance.now();
    if (!force && now - this.lastSend < 1000 / NET.clientSendHz) return;
    this.lastSend = now;
    if (!this.alive) return;
    const d = this.vehicles.driving;
    if (d) {
      this.net.emit('state', { p: [d.v.pos.x, d.v.pos.y, d.v.pos.z], ry: d.v.ry, pitch: this.camCtl.pitch, anim: 'drive' });
    } else {
      const p = this.player.position;
      this.net.emit('state', { p: [p.x, p.y, p.z], ry: this.player.ry, pitch: this.camCtl.pitch, anim: this.player.anim });
    }
  }

  // --- Interactions ---------------------------------------------------------

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
      if (input.consume('KeyE')) this.exitVehicle();
      return;
    }
    if (!this.alive) {
      this.hud.prompt(null);
      return;
    }
    const st = this.nearestStation(pos);
    if (st) {
      const c = this.welcome.challenges.find((x) => x.id === st.challengeId);
      const solved = this.progress.solved.includes(c.id);
      const demo = this.demos.describe(c.id);
      const isOpen = this.debugOpen === c.id;
      this.hud.prompt(`${isOpen ? 'Debugging' : `<kbd>E</kbd> ${solved ? 'Review' : 'Debug'}`} <b>${esc(c.title)}</b> (${c.reward} pts)${this.demos.hasDemo(c.id) ? ` · <kbd>F</kbd> ${esc(demo)}` : ` · <span class="muted">${esc(demo)}</span>`}`);
      if (input.consume('KeyE') && !isOpen) {
        this.layout.showDebugger();
        this.challengeUI.open(c.id);
      }
      if (input.consume('KeyF') && this.demos.hasDemo(c.id)) this.demos.run(c.id, this.progress);
      return;
    }
    const gate = this.nearestGatePanel(pos);
    if (gate) {
      const open = this.progress.gates.includes(gate.id);
      const c = this.welcome.challenges.find((x) => x.id === gate.requiresChallenge);
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
      if (input.consume('KeyE')) this.net.request('talk', { npc: npc.id });
      return;
    }
    const v = this.vehicles.nearest(pos);
    if (v) {
      this.hud.prompt(`<kbd>E</kbd> Enter ${esc(v.spec.name)}`);
      if (input.consume('KeyE')) this.enterVehicle(v);
      return;
    }
    this.hud.prompt(null);
  }

  async enterVehicle(v) {
    const r = await this.net.request('vehicle:enter', { id: v.id });
    if (!r || !r.ok) {
      this.hud.toast(r && r.error ? r.error : 'Could not enter the car.', 'warn');
      sfx.empty();
      return;
    }
    this.vehicles.startDriving(v.id);
    this.avatar.setVisible(false);
    sfx.door();
  }

  async exitVehicle() {
    const v = this.vehicles.stopDriving();
    this.avatar.setVisible(true);
    this.sendState(true);
    const r = await this.net.request('vehicle:exit', {});
    const out = r && r.ok && r.p ? r.p : [v.pos.x + Math.cos(v.ry) * 2.2, Math.max(0, v.pos.y), v.pos.z - Math.sin(v.ry) * 2.2];
    this.player.teleport(out);
  }

  // --- Frame loop -------------------------------------------------------------

  start() {
    this.running = true;
    let last = performance.now();
    const frame = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      try {
        this.tick(dt, now);
      } catch (e) {
        console.error(e);
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  tick(dt, now) {
    const [mx, my] = input.mouseDelta();
    if (input.locked) this.camCtl.look(mx, my);
    this.camCtl.aiming = input.aimDown && this.alive && !this.vehicles.driving;

    let focus;
    const driving = this.vehicles.driving;
    if (driving) {
      const pose = this.vehicles.drive(dt);
      focus = new THREE.Vector3(pose.x, pose.y, pose.z);
      // Keep the hidden player body with the car.
      this.physics.teleportPlayer(pose.x, -40, pose.z);
    } else {
      const p = this.player.update(dt, { frozen: !this.alive });
      focus = new THREE.Vector3(p.x, p.y, p.z);
    }
    this.gates.update(dt);
    this.physics.step(dt);
    this.vehicles.update(dt);

    // Local avatar.
    if (!driving) {
      this.avatar.root.position.copy(focus);
      this.avatar.root.rotation.y = this.player.ry;
      this.avatar.setAim(this.camCtl.pitch);
      this.avatar.setWeapon(this.weapons.equipped);
      this.avatar.animate(dt, this.alive ? this.player.anim : 'dead');
      this.avatar.setShield(this.shielded || this.spawnProtected, this.shielded ? '#4fe3ff' : '#ffd23f');
    }

    // Remote players.
    const renderTime = this.net.serverNow() - INTERP_DELAY;
    const remoteBoxes = [];
    const minimapPlayers = [];
    for (const rem of this.remotes.values()) {
      if (!rem.ch) continue;
      const pos = rem.state.sample(renderTime);
      if (!pos) continue;
      const stale = performance.now() - (rem.lastSeen || 0) > 2000;
      const inCar = rem.vehicleIdx >= 0;
      rem.ch.root.visible = !inCar && !stale && this.rosterById.has(rem.id);
      rem.ch.root.position.set(pos.x, pos.y, pos.z);
      rem.ch.root.rotation.y = rem.ry;
      rem.ch.setAim(rem.pitch);
      rem.ch.setWeapon(rem.weapon);
      rem.ch.animate(dt, rem.flags & 1 ? rem.anim : 'dead');
      rem.ch.setShield(!!(rem.flags & 6), rem.flags & 2 ? '#4fe3ff' : '#ffd23f');
      if (rem.ch.root.visible && rem.flags & 1) {
        remoteBoxes.push(new THREE.Box3(new THREE.Vector3(pos.x - 0.45, pos.y, pos.z - 0.45), new THREE.Vector3(pos.x + 0.45, pos.y + 1.85, pos.z + 0.45)));
      }
      if (!stale) minimapPlayers.push({ x: pos.x, z: pos.z, color: rem.ch.root.visible ? '#ff4f5e' : '#888' });
    }

    this.lastRemoteBoxes = remoteBoxes;
    const canFire = this.alive && !driving && input.locked && !(this.shielded) && document.getElementById('menu').hidden;
    this.weapons.update(dt, { playerPos: focus, canFire, remoteBoxes });
    this.camCtl.update(dt, focus, { inVehicle: !!driving });
    this.npcs.update(dt, focus);
    this.demos.update();
    this.interactions(focus);
    this.sendState();

    const target = this.missionView.update(focus);
    this.world.update(dt);
    this.view.update(dt, focus);

    // District banner.
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

    this.hud.shield(this.shielded);
    this.hud.crosshair({ visible: !driving && this.alive, aiming: this.camCtl.aiming });
    if (this.roundEndsAt) this.hud.bottomBar({ roundLeft: this.roundEndsAt - this.net.serverNow() });
    else this.hud.bottomBar({ roundLeft: null });

    this.frameMinimap = (this.frameMinimap || 0) + 1;
    if (this.frameMinimap % 3 === 0) {
      const stationStates = Object.fromEntries(STATIONS.map((s) => {
        const c = this.welcome.challenges.find((x) => x.id === s.challengeId);
        return [s.challengeId, this.progress.solved.includes(s.challengeId) ? 'solved' : this.progress.districts.includes(c.district) ? 'open' : 'locked'];
      }));
      this.minimap.draw({
        me: focus,
        yaw: this.camCtl.yaw,
        players: minimapPlayers,
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
      this.hud.fps(settings.showFps ? `${Math.round(this.frames / this.fpsTime)} FPS · ${this.view.renderer.info.render.calls} draws` : null);
      this.frames = 0;
      this.fpsTime = 0;
    }
  }
}
