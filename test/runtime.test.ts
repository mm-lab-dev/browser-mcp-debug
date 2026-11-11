import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { Runtime } from '../src/runtime';
import { DedicatedChrome } from '../src/chrome';
import { ManagedProcess } from '../src/processManager';
import { parseConfiguration } from '../src/config';
import { defaults } from './defaults';
import { assertPortAvailable } from '../src/mcp';

const log = { info() {}, error() {}, debug() {} };
class FixtureProcess extends ManagedProcess {
  constructor(name: string, private readonly mode: string) { super(name, log); }
  override start(_command: string, args: string[]): Promise<void> {
    if (this.name.startsWith('Playwright')) {
      assert.equal(args[args.indexOf('--cdp-endpoint') + 1], 'http://127.0.0.1:19222');
      assert.ok(!args.includes('--extension'));
      return super.start(process.execPath, [path.join(__dirname, 'fixtureHttpMcp.js'), args[args.indexOf('--port') + 1]]);
    }
    assert.ok(args.includes('--browser-url=http://127.0.0.1:19222'));
    assert.ok(!args.includes('--autoConnect'));
    if (this.mode === 'hang') return super.start(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
    if (this.mode === 'fail') return super.start(process.execPath, ['-e', 'process.exit(19)']);
    return super.start(process.execPath, [path.join(__dirname, 'fixtureMcp.js')]);
  }
}
class FixtureRuntime extends Runtime {
  readonly owned: ManagedProcess[] = [];
  mode = 'normal';
  readonly chromeCalls: string[] = [];
  protected override makeChrome(): DedicatedChrome {
    const calls = this.chromeCalls;
    return new class extends DedicatedChrome {
      override async start(): Promise<string> { calls.push('start'); return 'http://127.0.0.1:19222'; }
      override async stop(): Promise<void> { calls.push('stop'); }
    }(log);
  }
  protected override makeProcess(name: string): ManagedProcess {
    const child = new FixtureProcess(name, this.mode); this.owned.push(child); return child;
  }
}
async function port(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const result = (server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return result;
}
async function setup(timeout = 10000) {
  const pw = await port(), dt = await port();
  const failures: Error[] = [];
  const config = parseConfiguration({ target: 'Frontend', startupTimeout: timeout, playwrightMcp: { command: 'node', port: pw }, chromeDevtoolsMcp: { command: 'node', port: dt } }, defaults);
  const runtime = new FixtureRuntime(config, log, error => failures.push(error), path.resolve('.tmp/runtime-fixture-profile'));
  return { runtime, pw, dt, failures };
}
test('both MCP servers start and cleanup releases both ports', { timeout: 15000 }, async () => {
  const s = await setup();
  try {
    await s.runtime.start();
    assert.equal(s.runtime.owned.length, 2);
    assert.ok(s.runtime.owned.every(child => child.pid));
  } finally { await s.runtime.stop(); }
  await Promise.all([assertPortAvailable(s.pw), assertPortAvailable(s.dt)]);
  assert.equal(s.failures.length, 0);
  assert.deepEqual(s.runtime.chromeCalls, ['start', 'stop']);
});
test('second MCP crash allows rollback of first MCP', { timeout: 15000 }, async () => {
  const s = await setup(); s.runtime.mode = 'fail';
  try { await assert.rejects(s.runtime.start()); }
  finally { await s.runtime.stop(); }
  await Promise.all([assertPortAvailable(s.pw), assertPortAvailable(s.dt)]);
  assert.equal(s.failures.length, 1);
});
test('protocol startup timeout is cancellable and all owned processes stop', { timeout: 15000 }, async () => {
  const s = await setup(2000); s.runtime.mode = 'hang';
  try { await assert.rejects(s.runtime.start(), /timed out|aborted/i); }
  finally { await s.runtime.stop(); }
  await Promise.all([assertPortAvailable(s.pw), assertPortAvailable(s.dt)]);
});
