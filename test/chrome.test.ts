import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { createServer } from 'node:http';
import { DedicatedChrome, prepareProfile, profileEndpoint } from '../src/chrome';

test('dedicated profiles refuse existing browser data and retain owned data', async () => {
  const root = path.resolve('.tmp/chrome-tests');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'profile-'));
  try {
    await writeFile(path.join(directory, 'Preferences'), 'personal data');
    await assert.rejects(prepareProfile(directory), /Existing Chrome profiles/);
    assert.equal(await readFile(path.join(directory, 'Preferences'), 'utf8'), 'personal data');
    await rm(path.join(directory, 'Preferences'));
    await prepareProfile(directory);
    await writeFile(path.join(directory, 'Preferences'), 'dedicated data');
    await prepareProfile(directory);
    assert.equal(await readFile(path.join(directory, 'Preferences'), 'utf8'), 'dedicated data');
    await writeFile(path.join(directory, 'browser-mcp-profile.json'), '{"owner":"other"}');
    await assert.rejects(prepareProfile(directory), /ownership marker/);
    await assert.rejects(prepareProfile('relative/path'), /absolute path/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('dedicated endpoint requires the browser identity recorded in the profile', async () => {
  const root = path.resolve('.tmp/chrome-tests');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'endpoint-'));
  let identity = '/devtools/browser/owned';
  const server = createServer((_request, response) => {
    const address = server.address();
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${typeof address === 'object' && address?.port}${identity}` }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    await prepareProfile(directory);
    await writeFile(path.join(directory, 'DevToolsActivePort'), `${address.port}\n/devtools/browser/owned\n`);
    const signal = new AbortController().signal;
    assert.equal((await profileEndpoint(directory, signal)).url, `http://127.0.0.1:${address.port}`);
    const unowned = new DedicatedChrome({ info() {}, error() {}, debug() {} });
    await assert.rejects(unowned.start({}, directory, signal), /already using this profile/);
    await unowned.stop();
    assert.equal((await profileEndpoint(directory, signal)).url, `http://127.0.0.1:${address.port}`);
    identity = '/devtools/browser/unrelated';
    await assert.rejects(profileEndpoint(directory, signal), /identity/);
    await writeFile(path.join(directory, 'DevToolsActivePort'), 'not-a-port\n/devtools/browser/owned');
    await assert.rejects(profileEndpoint(directory, signal), /Invalid Chrome/);
    identity = '/devtools/browser/debugger-owned';
    await writeFile(path.join(directory, 'browser-mcp-endpoint.json'), JSON.stringify({ url: `http://127.0.0.1:${address.port}`, websocket: `ws://127.0.0.1:${address.port}${identity}` }));
    await rm(path.join(directory, 'DevToolsActivePort'));
    assert.equal((await profileEndpoint(directory, signal)).url, `http://127.0.0.1:${address.port}`);
    identity = '/devtools/browser/replaced';
    await assert.rejects(profileEndpoint(directory, signal), /identity/);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
