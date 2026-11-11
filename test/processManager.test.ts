import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { ManagedProcess } from '../src/processManager';
import { findExecutable, resolveCommand } from '../src/command';

const log = { info() {}, error() {}, debug() {} };
async function waitGone(pid: number): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try { process.kill(pid, 0); } catch { return; }
    await delay(50);
  }
  assert.fail(`Process ${pid} remains alive`);
}
const treeScript = `const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true}); console.log(c.pid); setInterval(()=>{},1000);`;
test('owned process and grandchild are stopped, stop is idempotent', { timeout: 15000 }, async () => {
  const child = new ManagedProcess('test', log);
  const stdout = once(child, 'stdout');
  try {
    await child.start(process.execPath, ['-e', treeScript]);
    const [output] = await stdout;
    const grandchild = Number(String(output).trim());
    assert.ok(grandchild > 0);
    const pid = child.pid!;
    await child.stop(); await child.stop();
    await Promise.all([waitGone(pid), waitGone(grandchild)]);
  } finally { await child.stop(); }
});
test('abnormal exit is reported and orphan grandchild is killed', { timeout: 15000 }, async () => {
  const child = new ManagedProcess('test crash', log);
  const stdout = once(child, 'stdout');
  const failure = once(child, 'failure');
  try {
    await child.start(process.execPath, ['-e', treeScript + 'setTimeout(()=>process.exit(17),300);']);
    const [output] = await stdout;
    const [error] = await failure;
    assert.match(error.message, /exited/);
    await waitGone(Number(String(output).trim()));
  } finally { await child.stop(); }
});
test('Extension Host disappearance triggers watchdog cleanup', { timeout: 15000 }, async () => {
  const managerPath = require.resolve('../src/processManager');
  const script = `const {ManagedProcess}=require(${JSON.stringify(managerPath)}); const p=new ManagedProcess('host-exit',{info(){},error(){}}); p.on('stdout',d=>{console.log(JSON.stringify({pid:p.pid,grandchild:Number(d.trim())})); setTimeout(()=>process.exit(0),100);}); p.start(process.execPath,['-e',${JSON.stringify(treeScript)}]);`;
  const host = spawn(process.execPath, ['-e', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const [output] = await once(host.stdout!, 'data');
  const pids = JSON.parse(String(output));
  await once(host, 'exit');
  await Promise.all([waitGone(pids.pid), waitGone(pids.grandchild)]);
});
test('missing executable gives actionable host error', async () => {
  await assert.rejects(findExecutable('browser-mcp-definitely-missing'), /Host executable not found/);
});
test('Windows npx resolves to node CLI without cmd shell interpolation', async () => {
  if (process.platform !== 'win32') return;
  const result = await resolveCommand('npx', ['-y', 'package;echo bad']);
  assert.match(result.command, /node\.exe$/i);
  assert.match(result.args[0], /npx-cli\.js$/);
  assert.equal(result.args[2], 'package;echo bad');
});
