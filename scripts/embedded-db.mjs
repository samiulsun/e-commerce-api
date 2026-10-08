/**
 * Embedded PostgreSQL runner — a no-Docker fallback for local development and tests.
 *
 * The canonical local-dev database is the `postgres` service in docker-compose.yml.
 * On machines where Docker cannot run (e.g. no WSL2/Hyper-V), this script spawns a
 * real PostgreSQL server as the current user from bundled binaries.
 *
 * Usage:
 *   node scripts/embedded-db.mjs start             # foreground server (Ctrl+C stops)
 *   node scripts/embedded-db.mjs start --detached  # background server, pidfile in .pgdata/
 *   node scripts/embedded-db.mjs stop              # stop a detached server
 *   node scripts/embedded-db.mjs status            # report whether the port is listening
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.resolve(process.env.PG_DATA_DIR ?? path.join(ROOT, '.pgdata'));
const PORT = Number(process.env.PG_PORT ?? 5432);
const USER = process.env.PG_USER ?? 'ecom';
const PASSWORD = process.env.PG_PASSWORD ?? 'ecom';
const DATABASES = (process.env.PG_DATABASES ?? 'ecom,ecom_test')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const PID_FILE = path.join(DATA_DIR, 'runner.pid');
const command = process.argv[2] ?? 'status';
const detached = process.argv.includes('--detached');

/** Resolves true when something accepts TCP connections on the port. */
function isPortOpen() {
  return new Promise((resolve) => {
    const socket = net.connect({ port: PORT, host: '127.0.0.1' });
    const done = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}

async function waitForPort(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function startForeground() {
  if (await isPortOpen()) {
    console.log(`Postgres already listening on port ${PORT}`);
    return;
  }
  if (!existsSync(path.join(DATA_DIR, 'PG_VERSION'))) {
    mkdirSync(DATA_DIR, { recursive: true });
    console.log(`Initialising cluster in ${DATA_DIR} ...`);
  }
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    onLog: (message) => {
      if (process.env.PG_VERBOSE) console.log(`[postgres] ${message}`);
    },
  });
  if (!existsSync(path.join(DATA_DIR, 'PG_VERSION'))) {
    await pg.initialise();
  }
  await pg.start();
  for (const database of DATABASES) {
    try {
      await pg.createDatabase(database);
      console.log(`Created database ${database}`);
    } catch {
      // Database already exists.
    }
  }
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(PID_FILE, String(process.pid));
  console.log(
    `Postgres ready: postgresql://${USER}:${PASSWORD}@localhost:${PORT} (databases: ${DATABASES.join(', ')})`,
  );
  console.log('Press Ctrl+C to stop.');

  const shutdown = async () => {
    console.log('\nStopping Postgres ...');
    try {
      await pg.stop();
    } catch {
      // Already stopped.
    }
    rmSync(PID_FILE, { force: true });
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // Keep the event loop alive while the server runs.
  setInterval(() => undefined, 1 << 30);
}

async function startDetached() {
  if (await isPortOpen()) {
    console.log(`Postgres already listening on port ${PORT}`);
    return;
  }
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'start'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  const ready = await waitForPort(90_000);
  if (!ready) {
    throw new Error('Postgres did not become ready within 90s — run without --detached to see logs');
  }
  console.log(`Postgres started in the background (port ${PORT})`);
}

function stop() {
  if (!existsSync(PID_FILE)) {
    console.log('No detached Postgres process recorded — nothing to stop');
    return;
  }
  const pid = readFileSync(PID_FILE, 'utf8').trim();
  rmSync(PID_FILE, { force: true });
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(Number(pid), 'SIGTERM');
    } catch {
      // Process already gone.
    }
  }
  console.log(`Stopped Postgres (pid ${pid})`);
}

async function main() {
  switch (command) {
    case 'start':
      if (detached) await startDetached();
      else await startForeground();
      break;
    case 'stop':
      stop();
      break;
    case 'status':
      console.log(
        (await isPortOpen())
          ? `Postgres is listening on port ${PORT}`
          : `Nothing is listening on port ${PORT}`,
      );
      break;
    default:
      console.error(`Unknown command "${command}" — use start | stop | status`);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
