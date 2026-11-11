import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { resolveCommand } from './command';
import { killTree } from './watchdog';
import { Log } from './logger';

export class ManagedProcess extends EventEmitter {
  private watchdog?: ChildProcess;
  private stopping = false;
  private stopTask?: Promise<void>;
  private exited = false;
  pid?: number;
  constructor(readonly name: string, private readonly log: Log) { super(); }
  async start(command: string, args: string[]): Promise<void> {
    if (this.watchdog || this.stopping) throw new Error(`${this.name} already started or stopped.`);
    const resolved = await resolveCommand(command, args);
    if (this.stopping) throw new Error('Startup cancelled.');
    this.log.info(`Starting ${this.name}: ${resolved.command} ${resolved.args.join(' ')}`);
    const watcher = this.watchdog = spawn(process.execPath, [path.join(__dirname, 'watchdog.js'), JSON.stringify([resolved.command, ...resolved.args])], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, detached: true,
      windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], shell: false
    });
    await new Promise<void>((resolve, reject) => {
      let started = false;
      const timer = setTimeout(() => reject(new Error(`${this.name} process startup timed out.`)), 10000);
      const failed = (message: string): void => {
        clearTimeout(timer);
        if (!started) reject(new Error(message));
        if (!this.stopping) this.emit('failure', new Error(message));
      };
      watcher.on('message', (message: { type: string; data?: string; pid?: number; code?: number; message?: string }) => {
        if (message.type === 'started') {
          started = true; this.pid = message.pid; clearTimeout(timer);
          this.log.info(`${this.name} PID ${this.pid}, watchdog PID ${watcher.pid}`); resolve();
        } else if (message.type === 'stdout') this.emit('stdout', message.data ?? '');
        else if (message.type === 'stderr') this.log.info(`[${this.name}] ${(message.data ?? '').trimEnd()}`);
        else if (message.type === 'failure') failed(`${this.name}: ${message.message}`);
        else if (message.type === 'exit') failed(`${this.name} exited (code ${message.code}).`);
      });
      watcher.on('error', error => failed(`${this.name} watchdog: ${error.message}`));
      watcher.on('exit', () => {
        this.exited = true;
        if (!this.stopping && this.pid) void killTree(this.pid).catch(error => this.log.debug(String(error)));
        failed(`${this.name} watchdog exited.`);
      });
    });
  }
  write(data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.watchdog?.connected || this.stopping) return reject(new Error(`${this.name} is not running.`));
      this.watchdog.send({ type: 'stdin', data }, error => error ? reject(error) : resolve());
    });
  }
  stop(): Promise<void> {
    return this.stopTask ??= this.stopInternal();
  }
  private async stopInternal(): Promise<void> {
    this.stopping = true;
    const watcher = this.watchdog;
    if (!watcher || this.exited) return;
    this.log.info(`Stopping ${this.name}`);
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        if (watcher.pid) void killTree(watcher.pid).catch(error => this.log.error(String(error))).finally(resolve);
        else resolve();
      }, 5000);
      watcher.once('exit', () => { clearTimeout(timer); resolve(); });
      if (watcher.connected) watcher.send({ type: 'stop' }, () => {});
    });
  }
}
