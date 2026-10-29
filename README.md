# Vice City: Bug Hunt 3D

A browser-based, multiplayer, third-person 3D city game with a neon 1980s
coastal look. A live JavaScript editor sits beside the game: you unlock the
city by fixing real, deliberately seeded bugs in the code that runs it, while
other players explore, drive and shoot around you.

Everything here is original: the city layout is generated from a seeded
random layout, all models are built from primitives, all sounds are
synthesised with the Web Audio API, and no GTA assets, names, maps, logos or
music are used.

## Quick start

Requirements: **Node.js 22.12 or newer** (the sandbox uses `vm.constants.DONT_CONTEXTIFY`
and the Node permission model) and a browser with WebGL.

```bash
npm ci          # installs the pinned dependencies from package-lock.json
npm start       # http://localhost:3000
```

Open the page, pick a name and press **Play Free Roam**. To play together,
open a second browser tab (with a different name) or have someone on your
network open `http://<your-ip>:3000`. Private rooms: open *Private rooms* in
the lobby, create one, and share the five-letter code.

Environment variables: `PORT` (default 3000), `HOST` (default 0.0.0.0),
`DB_FILE` (default `data/game.db`).

### Tests

```bash
npm test                 # 71 unit + integration tests (node:test, real sandbox, real Socket.IO)
npm run test:browser     # headless two-player browser run (needs Playwright, see below)
```

The browser test needs Playwright, which is not a runtime dependency:
`npm i -D playwright && npx playwright install chromium`.

## Controls

| Key | Action |
|---|---|
| W A S D | Move (camera-relative) / drive |
| Mouse | Look and aim (click the game to capture the mouse) |
| Left click / Right click | Fire / aim down sights |
| Shift / Space | Sprint / jump (handbrake in a car) |
| E | Interact: open a debugging station, talk, enter or exit a car, gate panel |
| F | Run a station's in-world demonstration of its bug |
| R / 1-4 | Reload / switch weapon |
| Tab | Leaderboard and profile |
| Esc | Pause menu and settings (sensitivity, volume, mute, graphics, lighting, FPS counter) |

When the code editor has focus, every key goes to the editor; clicking the
game hands control back. The divider between the game and the editor can be
dragged; under 900 px wide the layout stacks vertically.

## How the bug hunt works

Twelve challenges live in `challenges/`. Each one is a real function the game
uses, seeded with a bug you can see in the world:

| Challenge | District | What you see before the fix | What the fix changes |
|---|---|---|---|
| Ghost Wall (easy) | Ocean Drive | You walk through the Sunset Hotel | The hotel's walls use **your** `aabbOverlap()` and become solid |
| Broken Car (easy) | Ocean Drive | Every car door is "jammed" | You can enter and drive cars (server checks the approved rule) |
| Invisible Gate (medium, gate) | Ocean Drive | The gate test cycle opens the door but it stays solid | Unlocks Downtown; the gate's collision runs **your** `updateGate()` |
| Broken Mission (medium, gate) | Downtown | Delivering Rico's package to Vera never completes | Unlocks Vice Port; the courier mission can complete |
| Teleporting NPC (medium) | Downtown | Pedestrians zip and snap back to the start of their route | Pedestrians walk using **your** `stepNpc()` |
| Frozen Player (medium) | Downtown | Other players move in steps and freeze when packets run late | Other players are drawn with **your** `interpolateRemote()` |
| Flying Car (medium, gate) | Vice Port | The Dock Hauler floats into the sky and gets reset | Unlocks Neon District; the Dock Hauler drives with **your** physics |
| Broken Reload (hard) | Vice Port | The armory reload drill never finishes | Unlocks the Shotgun |
| Infinite Ammo (hard) | Neon District | The range blaster's ammo never goes down | Unlocks the SMG |
| Faulty Checkpoint (hard) | Neon District | Neon Run rings never register you | Neon Run works (server rule); unlocks the Rifle |
| Double Score (hard, gate) | Neon District | The payout terminal pays a duplicate mission | Unlocks the Industrial Zone |
| Broken Final Gate (expert, gate) | Industrial Zone | The vault controller reports nonsense; vault stays shut | Opens the Final Vault once your real progress qualifies |

Lifecycle: walk to a glowing station, press **E**. The challenge opens in the
right panel while the 3D game keeps running. Edit the function and press
**Run Tests**. The server runs your code in the sandbox against visible and
hidden tests and shows each result. **Apply Fix** only enables after every
test passes; applying it records the verified submission, pays the reward
once and switches the game behaviour. Drafts are saved to the server as you
type, so dying, disconnecting or closing the editor never loses work.

### Where fixed code runs

- **On your own client**, for things that only affect what you see or how
  you move (hotel collision, gate collision, pedestrians, remote-player
  interpolation, Port car physics, the station demos), the game runs the exact
  code you verified. Before the fix it runs the seeded buggy code, which is
  the same code shown in the editor.
- **On the server**, for anything competitive or security-relevant (vehicle
  entry, mission state, checkpoints, the final gate, district unlocks, combat,
  scoring), the server uses its own approved implementation once you have
  fixed the challenge. Before the fix it uses the buggy rule, but always
  combined with the approved rule (`buggy && approved`), so an unfixed bug can
  only make things harder, never grant something the real rule would refuse.
  Player code never runs in the game server.
- Infinite Ammo, Broken Reload and Double Score operate on training
  equipment (range blaster, reload bench, payout terminal). Real weapons and
  real scoring are always validated by the server.

## Architecture

```
client/            Browser game (ES modules, no framework, no bundler)
  src/scene.js           renderer, sky, lights, water
  src/world.js           city meshes from shared world data (merged + instanced)
  src/physics.js         Rapier colliders, kinematic character/car controllers
  src/player-controller.js, camera-controller.js, vehicle-controller.js
  src/weapon-controller.js, combat-ui.js (HUD), minimap.js, npc.js
  src/multiplayer.js     Socket.IO client, reconnect, interpolation buffers
  src/mission-manager.js missions, gates, station demos
  src/challenge-ui.js, code-editor.js (Monaco), challenge-runtime.js
  src/leaderboard.js, layout.js, settings.js, audio.js, input.js, game.js, main.js
shared/            Used by both sides: world layout, balance config
server/
  index.js               Express + Socket.IO, static files, HTTP API
  socket-handler.js      event validation and rate limits
  room-manager.js        rooms, movement validation, snapshots, rounds
  combat-manager.js      server-authoritative shooting
  mission-manager.js     missions from validated positions
  challenge-manager.js   open / draft / hint / run / apply
  progression.js         districts, gates, weapons, vault
  game-logic.js          approved and seeded rules for server-side behaviour
  sandbox-runner.js      spawns the isolated challenge worker
  database.js            SQLite schema and queries
sandbox/worker.js  Separate locked-down process that runs player code
challenges/        12 challenges (easy/medium/hard/expert)
tests/             node:test suites
scripts/browser-smoke.js  headless two-player browser test
```

Dependencies are pinned exactly in `package.json` and `package-lock.json`:
three 0.180.0, @dimforge/rapier3d-compat 0.18.2, monaco-editor 0.52.2,
socket.io / socket.io-client 4.8.1, express 5.1.0, better-sqlite3 12.4.1.
The client loads them from `node_modules` through the server (no CDN).

### Challenge sandbox

Player code never runs in the game server process. For each submission the
server spawns `sandbox/worker.js` as a separate Node process:

- Node permission model on (`--permission`): no file writes, no child
  processes, no worker threads; file reads limited to the worker file itself.
- Empty environment (no secrets), 64 MB heap limit, 4 s wall-clock kill,
  250 ms per test, 20 KB code limit, 6 runs per 20 s per player, at most 3
  sandboxes at once.
- Inside the process the code runs in a fresh V8 realm
  (`vm.constants.DONT_CONTEXTIFY`) with string code generation disabled, so
  `process`, `require`, `eval` and `new Function` are unavailable, and the
  classic `constructor.constructor` escape fails. Arguments go in and results
  come out as JSON text, so no host objects are shared.
- Tests and expected values stay in the worker's host realm; hidden tests do
  not reveal their inputs, so hard-coding visible answers fails.

Limits to be aware of: Node's permission model does not restrict outgoing
network access, and `vm` is not a hard security boundary on its own. For a
public deployment, run the worker inside a container or VM with networking
disabled (e.g. `docker run --network none`); the runner interface
(`runSubmission`) is small so it can be swapped for a container runner.

### Multiplayer and anti-cheat

- Clients send intents (move, fire with a direction, open, run tests); the
  server decides outcomes.
- Movement: speed limit per update, height limits, world bounds, locked
  districts and the vault are enforced; violations snap the player back.
- Combat: the server picks the shot origin from your validated position and
  checks weapon ownership, equipped weapon, cooldown (with a jitter
  allowance that cannot raise the sustained rate), ammo, reload timing,
  range, line of sight against the city geometry, spawn protection, the
  debugging shield, PvP settings and death state. Damage values come from the
  server's weapon table; client-sent damage or targets are ignored.
- Rewards: every score event has a unique reference in SQLite
  (`UNIQUE(player_id, kind, ref)`), so challenges, missions and kills pay
  once. Kills on the same victim stop paying after 3 in 2 minutes. Bug points,
  combat points and mission points are stored and shown separately.
- Network: 20 Hz client updates, 15 Hz snapshots with compact arrays, and
  interest management (players beyond 260 m are not sent). Disconnected
  players are kept for 30 s and resume their state on reconnect.

### Debugging while under fire

- **Free Roam:** safe debugging. While your editor is open and you are within
  9 m of the station, you have a shield: you cannot be damaged and cannot
  fire. Walking away drops it. You cannot open a station within 4 s of combat.
- **Bug Hunt Arena:** no shield. If you die, the editor stays open, the draft
  is saved, and you keep working while you respawn. Rewards are never lost or
  duplicated.

### Game modes

- **Free Roam** (public room, or private with PvP on/off).
- **Bug Hunt Arena** (8-minute rounds; session scores reset each round; the
  round winner gets a configurable bonus).

Balance values (weapons, points, timings, limits) are all in `shared/config.js`.

## Status: what is done and tested, and what is not

Done and covered by automated tests (`npm test`, `npm run test:browser`):

- 3D city with five districts, roads, beach, pier, port containers, neon
  signs, palms, streetlights, sunset/night lighting, water; minimap.
- Third-person controller (walk, sprint, jump, gravity, Rapier collisions,
  camera collision, falling out of the map respawns you).
- Six drivable cars with enter/exit, collisions and server-side position checks.
- Pistol, SMG, Shotgun, Rifle with server-validated hits, ammo, reload,
  cooldowns, range and line of sight; kill feed; death and respawn with spawn
  protection and safe spawn selection; anti-farming.
- Split-screen Monaco editor with draggable divider and stacked layout;
  editor focus blocks game keys (browser test).
- Twelve challenges, each verified: the reference solution passes and the
  seeded bug fails. Fixes change the game (browser test covers Ghost Wall,
  Broken Car and Invisible Gate end to end; server tests cover car entry,
  courier mission, checkpoints, gates and the vault).
- Sandbox isolation tests: infinite loops, memory bombs, `process`/`require`/
  `eval` escapes, JSON tampering, hard-coded answers, oversized code.
- Rooms (public and private), join/leave notifications, reconnection,
  session and persistent leaderboards (overall, bugs fixed, combat, K/D,
  fastest fix), profile with accuracy, SQLite persistence.

Implemented but only lightly tested (manual or indirect):

- Teleporting NPC, Frozen Player, Flying Car, Broken Reload, Infinite Ammo,
  Double Score and Final Gate in-world effects (the client wiring runs every
  frame in the browser test, and the browser test checks that buggy
  pedestrians teleport, but there is no automated before/after check for each).
- Arena rounds (unit-tested on the server; not played through in a browser).
- Audio, lighting presets, low-graphics mode, FPS counter.

Not implemented yet:

- Optional team mode and cooperative shared checkpoints.
- Vehicle health, repair garages and vehicle unlock/selection.
- Building interiors and enter/exit animations (cars switch instantly).
- Projectile weapons (all weapons are hitscan) and lag compensation (hits are
  checked against the latest server positions).
- Real accounts: identity is a random token stored in the browser per name.
- Server-side collision with buildings for movement validation (speed, height,
  bounds and locked areas are checked, but wall-clipping by a modified client
  is not).
- Load testing: capacity has **not** been measured. Rooms are capped at 16
  players; do not assume more until it is load-tested.
- Daily/session objectives.
