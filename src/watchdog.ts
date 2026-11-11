// Separate, detached Node process. IPC disconnect also handles Extension Host crashes.
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

export function killTree(pid: number): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) return Promise.reject(new Error('Invalid owned PID.'));
  if (process.platform === 'win32') {
    return new Promise((resolve, reject) => {
      const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
      killer.once('error', reject);
      killer.once('exit', code => {
        if (code === 0 || code === 128) resolve();
        else reject(new Error(`taskkill failed (${code}) for owned PID ${pid}.`));
      });
    });
  }
  try { process.kill(-pid, 'SIGKILL'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return Promise.reject(error);
  }
  return Promise.resolve();
}

if (require.main === module) {
  // Watchdog owns the child so Windows retains a living tree root until cleanup.
  const [command, ...args] = JSON.parse(process.argv[2]) as string[];
  let stopping = false;
  const child = spawn(command, args, { windowsHide: true, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
  const send = (value: unknown): void => { if (process.connected) process.send?.(value, () => {}); };
  const stdout = new StringDecoder('utf8'), stderr = new StringDecoder('utf8');
  child.stdout.on('data', (data: Buffer) => send({ type: 'stdout', data: stdout.write(data) }));
  child.stderr.on('data', (data: Buffer) => send({ type: 'stderr', data: stderr.write(data) }));
  child.on('spawn', () => send({ type: 'started', pid: child.pid }));
  child.stdin.on('error', error => { if (!stopping) { send({ type: 'failure', message: error.message }); void stop(); } });
  child.on('error', error => { send({ type: 'failure', message: error.message }); void stop(); });
  child.on('exit', (code, signal) => { send({ type: 'exit', code, signal }); void stop(); });
  async function stop(): Promise<void> {
    if (stopping) return;
    stopping = true;
    try {
      // On Windows kill the watchdog tree, including shell grandchildren whose
      // immediate npm parent may have already exited. taskkill itself is detached.
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(process.pid), '/T', '/F'], { detached: true, windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => process.exit(1));
        killer.unref();
      } else {
        if (child.pid) await killTree(child.pid);
        process.exit(0);
      }
    } catch { process.exit(1); }
  }
  process.on('message', (message: { type: string; data?: string }) => {
    if (message.type === 'stop') void stop();
    if (message.type === 'stdin' && !child.stdin.destroyed) child.stdin.write(message.data ?? '');
  });
  process.on('disconnect', () => void stop());
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
}
