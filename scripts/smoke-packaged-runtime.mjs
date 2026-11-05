// Run with the packaged executable in ELECTRON_RUN_AS_NODE mode, never the host's Node:
//   macOS:   ELECTRON_RUN_AS_NODE=1 "CellLab.app/Contents/MacOS/CellLab" scripts/smoke-packaged-runtime.mjs
//   Windows: ELECTRON_RUN_AS_NODE=1 "win-unpacked/CellLab.exe" scripts/smoke-packaged-runtime.mjs
// Starts the packaged app as a fresh user and checks SQLite, the bundled seed data and a clean quit.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';

assert.ok(process.versions.electron, 'Use the packaged Electron executable');
const isMac = process.platform === 'darwin';
const db = new DatabaseSync(':memory:');
try {
  db.exec("CREATE TABLE t(v TEXT); INSERT INTO t VALUES('CellLab')");
  assert.equal(db.prepare('SELECT v FROM t').get().v, 'CellLab');
} finally {
  db.close();
}
console.log(JSON.stringify({ electron: process.versions.electron, node: process.versions.node, arch: process.arch, sqlite: 'ok' }));

const home = mkdtempSync(join(tmpdir(), 'cell-lab-release-'));
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const debugPort = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const env = { ...process.env, HOME: home, CELL_LAB_USER_DATA: join(home, 'data'), CELL_LAB_DEBUG_PORT: String(debugPort) };
// macOS: no developer tools on PATH, as when the app starts from Finder.
if (isMac) env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
for (const key of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH', 'CELL_LAB_DB_DIR', 'CELL_LAB_FILES', 'CELL_LAB_APP_ROOT']) delete env[key];
const child = spawn(process.execPath, [], { cwd: home, env, stdio: 'ignore' });
const exited = once(child, 'exit');
let socket;
const commands = new Map();
let commandId = 0;

async function within(promise) {
  const timeout = Promise.withResolvers();
  const timer = setTimeout(() => timeout.reject(new Error('Packaged app smoke timed out')), 30_000);
  try { return await Promise.race([promise, timeout.promise]); }
  finally { clearTimeout(timer); }
}

async function until(read) {
  const end = Date.now() + 30_000;
  let lastError;
  do {
    if (child.exitCode !== null) throw new Error(`App exited early (${child.exitCode})`);
    try { const value = await read(); if (value) return value; }
    catch (error) { lastError = error; }
    await delay(100);
  } while (Date.now() < end);
  throw new Error('Packaged app did not become ready', { cause: lastError });
}

async function evaluate(expression) {
  const id = ++commandId;
  const result = Promise.withResolvers();
  commands.set(id, result);
  socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  try {
    const reply = await within(result.promise);
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
    return reply.result.value;
  } finally { commands.delete(id); }
}

try {
  const target = await until(async () => {
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    return targets.find(target => target.type === 'page' && target.url.startsWith('http://127.0.0.1:'));
  });
  socket = new WebSocket(target.webSocketDebuggerUrl);
  const opened = Promise.withResolvers();
  socket.addEventListener('open', () => opened.resolve(), { once: true });
  socket.addEventListener('error', error => opened.reject(error), { once: true });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    const command = commands.get(message.id);
    if (message.error) command?.reject(new Error(message.error.message));
    else command?.resolve(message.result);
  });
  await within(opened.promise);
  await until(() => evaluate('typeof window.cellLabDesktop?.getInfo === "function"'));
  const result = await evaluate(`(async () => {
    const json = async (path) => { const res = await fetch(path); if (!res.ok) throw new Error(path + ' ' + res.status); return res.json(); };
    const protocols = await json('/api/protocols');
    const media = await json('/api/catalog?category=base_medium');
    return {
      protocols: protocols.filter(p => p.builtin).map(p => p.id).sort(),
      media: media.map(o => o.label),
      info: await window.cellLabDesktop.getInfo(),
      nodeAccess: typeof window.require,
    };
  })()`);
  assert.deepEqual(result.protocols, ['sop-adherent', 'sop-suspension', 'western-blot-v1-1', 'western-lab-notes']);
  assert.ok(result.media.includes('RPMI 1640'));
  assert.equal(result.nodeAccess, 'undefined');
  assert.equal(result.info.dataDir, join(home, 'data'));
  assert.equal((await fetch(new URL('/api/settings', target.url))).status, 401);
  if (isMac) {
    socket.close();
    execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e',
      `ObjC.import('AppKit'); if (!$.NSRunningApplication.runningApplicationWithProcessIdentifier(${child.pid}).terminate) throw new Error('Could not quit smoke app');`]);
  } else {
    // Windows: closing the only window quits the app, as when a user closes it.
    socket.send(JSON.stringify({ id: ++commandId, method: 'Runtime.evaluate', params: { expression: 'window.close()' } }));
  }
  const [code] = await within(exited);
  assert.equal(code, 0);
  await assert.rejects(() => fetch(new URL('/api/settings', target.url)));
  console.log(JSON.stringify({ seedProtocols: result.protocols.length, catalog: 'ok', freshUser: true, nativeQuit: 'backend stopped' }));
} catch (error) {
  const logFile = isMac ? join(home, 'Library/Logs/cell-lab/desktop.log') : join(process.env.APPDATA ?? '', 'cell-lab', 'logs', 'desktop.log');
  try { console.error(readFileSync(logFile, 'utf8')); } catch {}
  throw error;
} finally {
  socket?.close();
  if (child.exitCode === null) { child.kill('SIGTERM'); await within(exited); }
  rmSync(home, { recursive: true, force: true });
}
