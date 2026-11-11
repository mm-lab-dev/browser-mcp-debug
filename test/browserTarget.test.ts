import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { isChromeLaunch, sharedChromeTarget } from '../src/browserTarget';

test('Chrome launch preserves tasks, URL and source maps while sharing one local dedicated browser', async () => {
  const root = path.resolve('.tmp/browser-target-tests');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'profile-'));
  try {
    const target = {
      type: 'pwa-chrome', request: 'launch', name: 'Angular', url: 'http://localhost:4200',
      preLaunchTask: 'npm: start', postDebugTask: 'cleanup', webRoot: '${workspaceFolder}',
      sourceMapPathOverrides: { 'webpack:/*': '${webRoot}/*' }, runtimeArgs: ['--disable-gpu', '--remote-debugging-pipe'],
      userDataDir: false, browserLaunchLocation: 'workspace'
    };
    assert.ok(isChromeLaunch(target));
    assert.ok(!isChromeLaunch({ type: 'node', request: 'launch' }));
    const shared = await sharedChromeTarget(target, {}, directory);
    assert.equal(shared.url, target.url);
    assert.equal(shared.preLaunchTask, target.preLaunchTask);
    assert.equal(shared.postDebugTask, target.postDebugTask);
    assert.deepEqual(shared.sourceMapPathOverrides, target.sourceMapPathOverrides);
    assert.equal(shared.webRoot, target.webRoot);
    assert.equal(shared.browserLaunchLocation, 'ui');
    assert.equal(shared.userDataDir, directory);
    assert.deepEqual(shared.runtimeArgs, ['--disable-gpu', `--remote-debugging-port=${shared.port}`, '--remote-debugging-address=127.0.0.1', '--enable-automation']);
    assert.equal(target.userDataDir, false);
    assert.deepEqual(target.runtimeArgs, ['--disable-gpu', '--remote-debugging-pipe']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
