# Vice City: Bug Hunt 3D

A single-player, third-person 3D city game with a neon 1980s coastal look. A
live JavaScript editor sits beside the game: you unlock the city by fixing
real, deliberately seeded bugs in the code that runs it, while glitch bots
patrol the streets.

The whole game runs in your browser. There is no game server, no account and
no network play: it is a static website, and your progress is saved in your
browser (IndexedDB).

Everything here is original: the city layout is generated from a seeded
random layout, all models are built from primitives, all sounds are
synthesised with the Web Audio API, and no GTA assets, names, maps, logos or
music are used.

## Quick start

Requires Node.js 20 or newer (only to install and build; the game itself
needs only a browser with WebGL).

```bash
npm ci            # installs the 3 pinned libraries
npm run dev       # play from the source tree at http://127.0.0.1:3000
```

Production build:

```bash
npm run build     # writes the static site to dist/
npm start         # serves dist/ at http://127.0.0.1:3000 (PORT and HOST env vars change it)
```

`dist/` is plain files. Any static host works; the page uses relative paths,
so it also works from a sub-folder (for example `https://example.com/game/`).
Opening `dist/index.html` straight from disk (`file://`) does **not** work,
because browsers block ES modules and workers there; use `npm start` or any
static web server.

### Hosting on Render (or similar)

On Render, create a **Static Site** from the repository with:

| Setting | Value |
|---|---|
| Build command | `npm ci && npm run build` |
| Publish directory | `dist` |

Render serves static sites over HTTPS by default. `render.yaml` holds the
same settings as a Blueprint. Netlify, Cloudflare Pages, GitHub Pages and
Vercel take the same two values. I have not deployed it to Render myself, so
the first deploy is the real check; nothing in the build depends on Render.

### Tests

```bash
npm test               # 55 engine tests (Node's built-in runner, no browser)
npm run test:browser   # the 14-point browser test (needs Playwright, see below)
```

The browser test plays the game in headless Chromium. Playwright is not a
dependency of the game; install it separately (`npm i -g playwright` and
`npx playwright install chromium`, or point `NODE_PATH` at an existing
install). `node scripts/browser-test.js --dist` tests the built `dist/`
instead of the source tree; add `--screenshots <folder>` or
`--report <file.json>` to keep the evidence.

## How to play

Click **New Game** (or **Continue**). Click the game view to start: the world
waits for that first click. Walk to the glowing debugging station on the
plaza and press **E**.

| Key | Action |
|---|---|
| W A S D | Move (drive when in a car) |
| Mouse | Look (click the game first) |
| Shift | Sprint |
| Space | Jump (brake in a car) |
| E | Talk, open a debugging station, enter or exit a car |
| F | Run a station demo |
| Left / right click | Shoot / aim |
| R, 1-4 | Reload, switch weapon |
| Tab | Inventory and stats |
| Esc | Pause menu |

- **Glitch bots** (red) patrol the streets, chase you when they see you, and
  shoot. Stopping one pays 50 points; it comes back after 30 seconds.
  Bots get tougher district by district.
- **Pickups:** blue diamonds are data chips (15 in the city, +25 each,
  collected once), white med kits heal 40, yellow ammo crates refill reserve
  ammo. Med kits and crates come back after 45 seconds.
- **Missions:** one per district (pier walk, courier delivery, dock run,
  Neon Run checkpoints, the vault). The tracker at the top left and the
  yellow beacon show the next step.
- **Safe debugging:** while a challenge is open and you are within 9 m of
  its station, a shield stops all damage (you cannot fire either). You
  cannot open a station within 4 seconds of a fight.

### Menus and saving

- **Main menu:** Continue Game (the newest save that passes its checks),
  New Game, Load Game (pick a save), Settings, Controls.
- **Pause menu (Esc):** Resume, Save Game, Restart, Settings, Exit to Main
  Menu. The game is stopped while it is open.
- **Autosave** runs every minute of play, a moment after each fix, mission
  and data chip, when you hide or leave the tab, and on Exit to Main Menu.
- **Settings:** mouse sensitivity, invert look, volume, mute, graphics
  quality (High with shadows, Medium, Low), sunset or night lighting, FPS
  counter. Settings are kept in the browser and written into each save.

## The bug hunt

Twelve challenges live in `challenges/`. Each one is a real function the game
uses, seeded with a bug you can see in the world:

| Challenge | District | What you see before the fix | What the fix changes |
|---|---|---|---|
| Ghost Wall (easy) | Ocean Drive | You walk through the Sunset Hotel | The hotel's walls use **your** `aabbOverlap()` and become solid |
| Broken Car (easy) | Ocean Drive | Every car door is "jammed" | You can enter and drive cars |
| Invisible Gate (medium, gate) | Ocean Drive | The gate test cycle opens the door but it stays solid | Unlocks Downtown; the gate's collision runs **your** `updateGate()` |
| Broken Mission (medium, gate) | Downtown | Delivering Rico's package to Vera never completes | Unlocks Vice Port; the courier mission can complete |
| Teleporting NPC (medium) | Downtown | Pedestrians zip and snap back to the start of their route | Pedestrians walk using **your** `stepNpc()` |
| Frozen Bots (medium) | Downtown | Glitch bots move in steps and freeze | Bots are drawn with **your** `interpolateRemote()` |
| Flying Car (medium, gate) | Vice Port | The Dock Hauler floats into the sky and gets reset | Unlocks Neon District; the Dock Hauler drives with **your** physics |
| Broken Reload (hard) | Vice Port | The armory reload drill never finishes | Unlocks the Shotgun |
| Infinite Ammo (hard) | Neon District | The range blaster's ammo never goes down | Unlocks the SMG |
| Faulty Checkpoint (hard) | Neon District | Neon Run rings never register you | Neon Run works; unlocks the Rifle |
| Double Score (hard, gate) | Neon District | The payout terminal pays a duplicate mission | Unlocks the Industrial Zone |
| Broken Final Gate (expert, gate) | Industrial Zone | The vault controller reports nonsense; vault stays shut | Opens the Final Vault once your real progress qualifies |

Press **Run Tests** to run your code against visible and hidden tests in a
separate Web Worker. **Apply Fix** only enables after every test passes; it
pays the reward once and switches the game behaviour. Drafts are kept as you
type and saved with the game.

**Easy mode** (on by default, toggle at the top of the challenge panel)
explains every seeded bug in plain words, highlights the buggy lines, and
offers **Show Fix**, which fills in the reference fix for half the reward.
The explanations live in `challenges/guides.js`.

The "Frozen Player" challenge became **Frozen Bots**: there are no other
players any more, so its interpolation function now draws the glitch bots
(see `client/src/enemy-view.js`). Its id is still `frozen-player`.

## Architecture

```
index page (client/index.html)
 ├─ main.js        main menu, settings screen, boot, New/Continue/Load
 ├─ game.js        frame loop, pause, interactions, HUD events, saving
 │   ├─ scene, world, physics (Rapier), camera, player, vehicles, NPCs
 │   ├─ enemy-view, pickup-view, effects (pooled tracers)   ← draw the engine's state
 │   ├─ weapon-controller   asks the engine to fire, draws the result
 │   ├─ challenge-ui + code-editor (Monaco) + sandbox-runner (Web Worker)
 │   └─ save-store          IndexedDB slots, localStorage fallback
 └─ engine/ (no DOM; runs in the browser and in Node for tests)
     ├─ session.js     GameSession: the one game, its clock, events, snapshot()
     ├─ store.js       score events, stats, challenge progress, missions, chips
     ├─ progression.js districts, gates, weapons, vault
     ├─ missions.js    mission steps and rewards
     ├─ challenges.js  open / hint / run / apply for the 12 bugs
     ├─ combat.js      hitscan weapons, ammo, reload, line of sight
     ├─ enemies.js     glitch bot AI (patrol, chase, shoot, return, respawn)
     ├─ pickups.js     data chips, med kits, ammo crates
     ├─ game-logic.js  the approved rules used after each fix
     └─ save.js        save format, checksum and validation
```

- **One loop.** `game.js` runs one `requestAnimationFrame` loop. Each frame it
  moves the player or car with Rapier, then calls `session.update(dt)` (bots,
  respawns, reloads) and `session.setPosition()` (locked districts, missions,
  pickups). The engine reports what happened through events (`damaged`,
  `kill`, `pickup`, `mission`, `progress`, `autosave`, ...) and the page draws
  it.
- **Game clock.** The engine's clock only advances inside `update()`, so
  pausing stops bots, respawn timers, reloads, pickups and play time.
- **Rules.** Before a fix, the engine uses the seeded buggy rule combined
  with the approved one (`buggy && approved`), so an unfixed bug can only make
  things harder. After the fix it uses the approved rule. Visual behaviour
  (hotel walls, gate, pedestrians, bots, the Dock Hauler, station demos) runs
  the exact code you verified.
- **No backend.** The game does not need a server for anything. The tiny
  `scripts/serve.js` only serves files for local play and tests.

### Save and load

`engine/save.js` defines the save file:

```
{ format: "vice-city-bughunt-save", version: 1, savedAt, playTimeMs, label,
  summary: { score, bugsFixed, missions, district },
  settings: { sensitivity, invertY, volume, muted, graphics, lighting, showFps },
  state: {
    clockMs, killSeq,
    player: { pos, ry, health, equipped, loadout: { pistol: { ammo, reserve }, ... } },
    missionState: { "m-ocean": { step, courier }, ... },
    store: { scoreEvents, stats, attempts, challengeProgress (drafts, hints,
             verified code), completions (fixed bugs and their code),
             missions (completed), collected (data chips) },
    enemies: [{ id, alive, health, respawnInMs }],
    vehicles: [[x, y, z, heading], ...] },
  checksum }
```

- **Where:** IndexedDB database `vice-city-bughunt`, two slots: `manual`
  (Save Game) and `auto` (autosave). Writing a slot first copies the old save
  to `<slot>-backup`. If IndexedDB is unavailable (some private windows), the
  same slots go to localStorage.
- **Checks:** every save carries an FNV-1a checksum of its state. Loading
  parses the JSON, checks the checksum, then validates every field (types,
  ranges, known challenge and mission ids, position inside the city). A save
  is also checked before it is written.
- **New Game** starts from the fixed starting state. **Continue** loads the
  newest save that passes all checks. **Load Game** lists every save.
  **Save Game** writes the manual slot. **Restart** reloads the page into a
  new game (saves are kept). **Exit to Main Menu** autosaves, then reloads.
- **Damaged saves** (truncated, edited, wrong version) are never loaded. The
  main menu names the damaged slot and the reason, and Continue falls back to
  the newest intact save, usually the backup.
- A save made in a car stores the spot beside the car. A save made while
  down restores you alive at full health.

Restart and Exit reload the page instead of tearing the game down in place.
A reload frees every GPU buffer, physics body and event listener at once,
which is the most reliable way to avoid leaks between games.

### Performance

- Effects are pooled: 64 tracer lines and 48 impact sparks are created once
  and recycled; pickups share one geometry and material per kind; each bot
  keeps one model through death and respawn. The browser test checks that
  firing hundreds of shots adds no scene objects or GPU buffers.
- Bots look for you 5 times a second, not every frame. Bots more than 110 m
  away or in another district only follow their patrol loop. Far bots skip
  animation; far pedestrians are hidden.
- Graphics quality: **High** (shadows, antialiasing, up to 1.75x pixel
  ratio, 520 m view), **Medium** (default: no shadows, antialiasing, 1.25x,
  420 m), **Low** (no shadows or antialiasing, 1x, 300 m). It applies the
  next time the city loads.
- The target is 60 FPS on hardware that allows it; that is a target, not a
  guarantee. I have **not** measured frame rate on real graphics hardware.
  The only numbers I have are from the headless test machine, which renders
  in software (about 21-28 FPS there), so they say nothing about a real
  computer. Turn on the FPS counter in Settings to see yours.

## Dependencies

Runtime libraries (exact versions, copied into `dist/vendor/`, no CDN):

| Package | Version | Used for |
|---|---|---|
| `three` | 0.180.0 | 3D rendering |
| `@dimforge/rapier3d-compat` | 0.18.2 | Physics and collisions |
| `monaco-editor` | 0.52.2 | The code editor |

Removed in the single-player conversion: `express`, `socket.io`,
`socket.io-client` and `better-sqlite3`. The Redis and Postgres clients from
the abandoned cluster work are not in this version either. There are no dev dependencies; tests use
Node's built-in runner. Licences of the shipped libraries are in
`LICENSES.txt`.

## What changed from the multiplayer version

Removed: the Express/Socket.IO game server, rooms, lobby, matchmaking, player
names and tokens, reconnection, snapshots and remote-player rendering, server
movement validation, the SQLite database, PvP, the multiplayer leaderboard,
Arena rounds and anti-farming. The unfinished 4-laptop cluster work (Redis,
gateways, load tests) is kept only on the git branch `archive/cluster-attempt`
and is not part of this version.

Moved: the game rules (progression, missions, challenges, combat) moved from
`server/` to `engine/` and now run in the page. Challenge tests now run in a
Web Worker with a watchdog instead of a server-side child process.

Added: glitch bot enemies, pickups and data chips, main menu, pause menu,
save/load with autosave and backups, Tab inventory and stats panel, vehicle
HUD, three graphics levels, the static build, and the browser test below.

## Testing report

Run on 30 October 2026 with Node 22 and headless Chromium (software WebGL).

**Engine tests (`npm test`): 55 passed, 0 failed.** They cover the new-game
state, locked districts, missions paid once, the courier mission, car doors,
weapons (cooldown, ammo, reload, unlocks), bots (kill, respawn, shooting the
player, the debugging shield), pickups, falling out of the map, a full city
clear, save round trips, damaged and edited saves, all 12 challenges
(reference fix passes, seeded bug fails), Easy mode and the test runner.

**Browser test (`npm run test:browser`): 14 of 14 checks passed**, on three
consecutive runs against the source tree and once against `dist/`:

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Game loads | Pass | Main menu shown; city ready about 3 s after New Game |
| 2 | Main menu works | Pass | Continue disabled with no save; Controls, Settings, Back; settings stored |
| 3 | New Game starts correctly | Pass | Spawn (30, 0, -40), health 100, score 0, Ocean Drive and pistol only, 15 bots; world waits for the first click |
| 4 | Movement works | Pass | Walk 5.0 m/s, sprint 8.5 m/s (per second of game time), jump peak about 1 m, lands again |
| 5 | Camera works | Pass | Mouse turns and tilts the camera; it follows the player |
| 6 | Collision works | Pass | Walking into a building stops at its wall |
| 7 | NPCs and interactions work | Pass | Pedestrians walk; debugger fix via E, Run Tests, Apply Fix; car door jammed then fixed; driving and vehicle HUD; talking to Rico; bots patrol, shoot and can be stopped; an infinite loop in player code is stopped after 1 s |
| 8 | Missions can be completed | Pass | "Welcome to Vice" completes and pays 150; data chip collected; Tab panel |
| 9 | Pause and resume | Pass | Clock, play time and pedestrians frozen while paused; run again after Resume |
| 10 | Save and load | Pass | Save Game to IndexedDB; after reload Continue restores score, fixes, chips, missions, courier step, position, gates, play time; a damaged save is reported and the intact one loads |
| 11 | Restart | Pass | Asks first; returns to the starting state; saves kept |
| 12 | No multiplayer or network dependencies | Pass | No WebSocket opened; every request stayed on the static site; no networking globals |
| 13 | Works after a refresh | Pass | A fix made just before the refresh is restored from the autosave |
| 14 | No major console errors or leaks | Pass | No console errors or exceptions in the whole run; scene object count unchanged and GPU geometries +2 after hundreds of shots; JS heap grew under 0.2 MB (about 24.7 MB) after garbage collection |

What the browser test does not prove:

- It moves the player by teleporting in small steps between checks, and
  keeps the bots out of the way outside the combat check, so runs are
  repeatable. Walking, sprinting, jumping, driving and shooting themselves are
  tested with real key presses.
- It measures memory over a few minutes, not hours.
- Frame rate on real hardware is not measured (see Performance).
- Sound, the night lighting preset and the High graphics level are not
  checked automatically.
- Of the twelve fixes, the browser test applies Ghost Wall, Broken Car and
  Invisible Gate end to end; the engine tests cover the rule changes of the
  rest, and the in-world effects of Teleporting NPC, Frozen Bots, Flying Car
  and the station demos have no automated before/after check.

## Known limits

- **Cheating is possible.** Everything runs in your browser, including the
  reference fixes and hidden tests, so a player can read them in the page
  source or edit their save. That is acceptable for a single-player game;
  the save checksum only catches damage, not deliberate edits.
- Saves live in one browser on one computer. Clearing site data deletes
  them, and there is no export, import or cloud sync yet.
- No touch controls: it needs a keyboard and mouse.
- Graphics quality changes apply on the next load, not instantly.
- All weapons are hitscan; bots do not take cover or use doors.
- Not implemented: building interiors, vehicle damage, more mission types,
  difficulty settings, rebindable keys.
