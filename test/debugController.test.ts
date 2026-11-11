import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { DebugController, SingleRunLease } from '../src/debugController';
import { parseConfiguration } from '../src/config';
import { defaults } from './defaults';

const log = { info() {}, error() {}, debug() {} };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(lease = new SingleRunLease(), targetOwnsBrowser = false) {
  const messages: any[] = [];
  const errors: Error[] = [];
  const runtimeReady = deferred<void>();
  const targetReady = deferred<boolean>();
  let runtimeStops = 0, targetStarts = 0, targetStops = 0;
  const controller = new DebugController(message => messages.push(message), {
    targetOwnsBrowser,
    startTarget: () => { targetStarts++; return targetReady.promise; },
    stopTargets: async () => { targetStops++; }, report: error => errors.push(error)
  }, lease, () => ({ start: () => runtimeReady.promise, stop: async () => { runtimeStops++; runtimeReady.reject(new Error('cancelled')); } }), parseConfiguration({ target: 'Frontend' }, defaults), log);
  const launch = () => controller.handle({ seq: 2, type: 'request', command: 'launch' });
  return { controller, launch, runtimeReady, targetReady, messages, errors, counts: () => ({ runtimeStops, targetStarts, targetStops }) };
}
test('starts MCP before target and cleans once when target ends', async () => {
  const s = setup(); s.launch();
  assert.equal(s.counts().targetStarts, 0);
  s.runtimeReady.resolve(); await setImmediate();
  assert.equal(s.counts().targetStarts, 1);
  s.targetReady.resolve(true); await setImmediate();
  assert.equal(s.messages.find(m => m.command === 'launch')?.success, true);
  s.controller.targetEnded(); await s.controller.stop(); await s.controller.stop();
  assert.equal(s.counts().runtimeStops, 1);
  assert.equal(s.messages.filter(m => m.event === 'terminated').length, 1);
});
test('Chrome target starts its single browser before MCP and rolls back on MCP failure', async () => {
  const s = setup(new SingleRunLease(), true); s.launch();
  assert.equal(s.counts().targetStarts, 1);
  s.targetReady.resolve(true); await setImmediate();
  assert.equal(s.messages.some(m => m.command === 'launch'), false);
  s.runtimeReady.reject(new Error('MCP cannot connect')); await setImmediate();
  await s.controller.stop();
  assert.ok(s.counts().targetStops > 0);
  assert.equal(s.counts().runtimeStops, 1);
  assert.equal(s.messages.find(m => m.command === 'launch')?.success, false);
});
test('MCP startup failure rolls back and does not start target', async () => {
  const s = setup(); s.launch(); s.runtimeReady.reject(new Error('port occupied'));
  await setImmediate(); await s.controller.stop();
  assert.equal(s.counts().targetStarts, 0);
  assert.equal(s.counts().runtimeStops, 1);
  assert.match(s.errors[0].message, /port occupied/);
  assert.equal(s.messages.find(m => m.command === 'launch')?.success, false);
});
test('stop during MCP startup cancels target startup', async () => {
  const s = setup(); s.launch(); await s.controller.stop(); await setImmediate();
  assert.equal(s.counts().targetStarts, 0);
  assert.equal(s.counts().runtimeStops, 1);
});
test('stop while target preLaunchTask is pending stops late target', async () => {
  const s = setup(); s.launch(); s.runtimeReady.resolve(); await setImmediate();
  await s.controller.stop(); s.targetReady.resolve(true); await setImmediate();
  assert.ok(s.counts().targetStops >= 2);
  assert.equal(s.messages.find(m => m.command === 'launch')?.success, false);
});
test('duplicate launch is rejected without releasing another owner lease', async () => {
  const lease = new SingleRunLease();
  const first = setup(lease); first.launch();
  const second = setup(lease); second.launch(); await setImmediate();
  assert.match(second.errors[0].message, /already running/);
  const third = setup(lease); third.launch(); await setImmediate();
  assert.match(third.errors[0].message, /already running/);
  await first.controller.stop();
  const fourth = setup(lease); fourth.launch(); await fourth.controller.stop();
  assert.equal(fourth.errors.length, 0);
});
test('target refusal stops MCP', async () => {
  const s = setup(); s.launch(); s.runtimeReady.resolve(); await setImmediate();
  s.targetReady.resolve(false); await setImmediate();
  assert.match(s.errors[0].message, /Could not start target/);
  assert.equal(s.counts().runtimeStops, 1);
});

test('stop during profile acquisition waits for ownership and releases without starting Chrome', async () => {
  const ready = deferred<void>();
  const actions: string[] = [];
  const controller = new DebugController(() => {}, {
    targetOwnsBrowser: true,
    prepare: () => ready.promise,
    release: async () => { actions.push('release'); },
    startTarget: async () => { actions.push('target'); return true; },
    stopTargets: async () => {}, report: assert.fail
  }, new SingleRunLease(), () => { throw new Error('Runtime must not start'); }, parseConfiguration({ target: 'Frontend' }, defaults), log);
  controller.handle({ seq: 1, type: 'request', command: 'launch' });
  const stopped = controller.stop();
  await setImmediate();
  assert.deepEqual(actions, []);
  ready.resolve();
  await stopped;
  await controller.waitForLaunch();
  assert.deepEqual(actions, ['release']);
});
