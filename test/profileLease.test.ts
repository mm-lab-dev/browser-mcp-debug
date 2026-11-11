import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ProfileLease } from '../src/profileLease';

test('profile lease excludes another Extension Host, releases ownership, and permits separate profiles', async () => {
  const root = path.resolve('.tmp/profile-lease-tests');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'profile-'));
  const first = new ProfileLease(directory, assert.fail);
  const other = new ProfileLease(path.join(directory, 'other'), assert.fail);
  try {
    await first.acquire();
    await other.acquire();
    const modulePath = path.join(__dirname, '../src/profileLease.js');
    const child = spawn(process.execPath, ['-e', `const {ProfileLease}=require(process.argv[1]); new ProfileLease(process.argv[2], console.error).acquire().then(()=>process.exit(2),error=>{console.log(error.message);process.exit(0)});`, modulePath, directory], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    assert.equal(code, 0);
    assert.match(output, /in use by another Browser MCP session/);
    await first.release();
    const next = new ProfileLease(directory, assert.fail);
    await next.acquire();
    await next.release();
  } finally { await other.release(); await first.release(); await rm(directory, { recursive: true, force: true }); }
});
