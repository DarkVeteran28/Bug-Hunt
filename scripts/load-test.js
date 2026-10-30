// Basic Socket.IO load test for Free Roam. Use against a local or staging
// server first; each run creates persistent test player accounts.
import { io } from 'socket.io-client';

function optionsFrom(argv) {
  const opts = { url: 'http://localhost:3000', players: 100, rooms: 10, duration: 60, hz: 20 };
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (key === 'url') opts.url = value;
    else if (key === 'players') opts.players = Number(value);
    else if (key === 'rooms') opts.rooms = Number(value);
    else if (key === 'duration') opts.duration = Number(value);
    else if (key === 'hz') opts.hz = Number(value);
  }
  if (argv.includes('--help')) {
    console.log('Usage: node scripts/load-test.js [--url=http://localhost:3000] [--players=100] [--rooms=10] [--duration=60] [--hz=20]');
    process.exit(0);
  }
  if (!Number.isInteger(opts.players) || opts.players < 1) throw new Error('--players must be a positive integer.');
  if (!Number.isInteger(opts.rooms) || opts.rooms < 1 || opts.rooms > opts.players) throw new Error('--rooms must be between 1 and --players.');
  if (Math.ceil(opts.players / opts.rooms) > 16) throw new Error('A room can hold at most 16 players; increase --rooms.');
  if (!Number.isFinite(opts.duration) || opts.duration < 1) throw new Error('--duration must be at least 1 second.');
  if (!Number.isFinite(opts.hz) || opts.hz < 1 || opts.hz > 30) throw new Error('--hz must be between 1 and 30.');
  return opts;
}

const opts = optionsFrom(process.argv.slice(2));
const clients = [];
const roomCodes = [];
let snapshots = 0;
let ticker;

function connect(name) {
  return new Promise((resolve, reject) => {
    const socket = io(opts.url, {
      auth: { name },
      transports: ['websocket'],
      reconnection: false,
      timeout: 15_000,
    });
    const timeout = setTimeout(() => reject(new Error(`Timed out connecting ${name}.`)), 20_000);
    socket.once('connect', () => {
      clearTimeout(timeout);
      socket.off('connect_error', onInitialError);
      socket.on('s', () => { snapshots++; });
      clients.push({ socket, name, pos: [0, 0, 0] });
      resolve(clients[clients.length - 1]);
    });
    const onInitialError = (err) => {
      clearTimeout(timeout);
      reject(new Error(`Could not connect ${name}: ${err.message}`));
    };
    socket.once('connect_error', onInitialError);
  });
}

function join(client, request) {
  return new Promise((resolve, reject) => {
    client.socket.timeout(10_000).emit('room:join', request, (err, result) => {
      if (err) return reject(new Error(`Join timed out for ${client.name}.`));
      if (!result?.ok) return reject(new Error(`Join failed for ${client.name}: ${result?.error || 'unknown error'}`));
      client.pos = result.you.pos;
      resolve(result);
    });
  });
}

async function health() {
  try {
    const res = await fetch(new URL('/api/health', opts.url));
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function run() {
  const tag = Math.random().toString(36).slice(2, 8);
  const startedConnecting = Date.now();
  console.log(`Connecting ${opts.players} simulated clients to ${opts.url} in ${opts.rooms} Free Roam rooms…`);

  // Create one room at a time. The owner client counts toward that room's 16.
  for (let i = 0; i < opts.rooms; i++) {
    const owner = await connect(`lt${tag}_${i}`);
    const result = await join(owner, { create: { mode: 'freeroam', pvp: false } });
    roomCodes.push(result.room.code);
  }

  // Spread remaining joins slightly so the test doesn't measure only a
  // simultaneous connection spike.
  for (let i = opts.rooms; i < opts.players; i++) {
    const client = await connect(`lt${tag}_${i}`);
    await join(client, { code: roomCodes[i % opts.rooms] });
    if (i % 10 === 9) await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const connectSeconds = (Date.now() - startedConnecting) / 1000;
  const before = await health();
  const sentAt = Date.now();
  const interval = 1000 / opts.hz;
  ticker = setInterval(() => {
    for (const client of clients) {
      if (client.socket.connected) client.socket.emit('state', { p: client.pos, ry: 0, pitch: 0, anim: 'idle' });
    }
  }, interval);

  console.log(`All ${clients.length} clients joined in ${connectSeconds.toFixed(1)}s. Sending ${opts.hz} movement updates/sec/client for ${opts.duration}s…`);
  await new Promise((resolve) => setTimeout(resolve, opts.duration * 1000));
  clearInterval(ticker);
  ticker = null;
  const elapsed = (Date.now() - sentAt) / 1000;
  const after = await health();
  console.log('\nLoad test summary');
  console.log(`  connected clients: ${clients.filter((c) => c.socket.connected).length}/${opts.players}`);
  console.log(`  rooms created: ${roomCodes.length}`);
  console.log(`  duration: ${elapsed.toFixed(1)}s`);
  console.log(`  snapshots received: ${snapshots} (${(snapshots / elapsed).toFixed(1)}/sec total)`);
  if (before && after) console.log(`  server health players: ${before.players} before, ${after.players} after`);
  console.log('  Review the Render service metrics and logs during this interval for CPU, memory, disconnects, and errors.');
}

try {
  await run();
} catch (err) {
  console.error(`Load test stopped: ${err.message}`);
  process.exitCode = 1;
} finally {
  if (ticker) clearInterval(ticker);
  for (const client of clients) client.socket.disconnect();
  setTimeout(() => process.exit(), 100).unref();
}
