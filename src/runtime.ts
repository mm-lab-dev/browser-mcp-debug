import { Configuration } from './config';
import { Log } from './logger';
import { ManagedProcess } from './processManager';
import { assertPortAvailable } from './mcp';
import { findExecutable, resolveCommand } from './command';
import { startPlaywright } from './playwrightMcp';
import { DevtoolsGateway } from './chromeDevtoolsMcp';
import { DedicatedChrome } from './chrome';
import { mkdir } from 'node:fs/promises';
import * as path from 'node:path';

export class Runtime {
  private readonly processes: ManagedProcess[] = [];
  private gateway?: DevtoolsGateway;
  private readonly abort = new AbortController();
  private stopTask?: Promise<void>;
  private startup?: Promise<void>;
  private failed = false;
  private chrome?: DedicatedChrome;
  private ready = false;
  constructor(private readonly config: Configuration, private readonly log: Log, private readonly onFailure: (error: Error) => void, private readonly profileDirectory?: string, private readonly debuggerPort?: () => number | undefined, private readonly fileRoots: string[] = []) {}
  start(): Promise<void> {
    if (this.startup) throw new Error('Runtime already started.');
    this.startup = this.startInternal();
    return this.startup;
  }
  private async startInternal(): Promise<void> {
    const { config, log } = this;
    const playwright = { ...config.playwright };
    const devtools = { ...config.devtools };
    const timeout = setTimeout(() => this.abort.abort(new Error(`MCP startup timed out after ${config.startupTimeout} ms. See Browser MCP output.`)), config.startupTimeout);
    const signal = this.abort.signal;
    try {
      await findExecutable('node');
      for (const options of [config.playwright, config.devtools]) {
        if (options.enabled) {
          await resolveCommand(options.command, ['--version']);
          await assertPortAvailable(options.port);
        }
      }
      signal.throwIfAborted();
      const directory = config.browser.userDataDir ?? this.profileDirectory;
      if (!directory) throw new Error('Dedicated Chrome profile directory is missing.');
      this.chrome = this.makeChrome();
      const port = this.debuggerPort?.();
      if (this.debuggerPort && !port) throw new Error('Chrome debugger did not supply its dedicated browser endpoint.');
      const endpoint = await this.chrome.start(config.browser, directory, signal, port);
      // Sequential starts make partial-start rollback deterministic.
      if (playwright.enabled) await startPlaywright(this.createProcess('Playwright MCP'), playwright, endpoint, signal, log);
      signal.throwIfAborted();
      if (devtools.enabled) {
        const outputDirectory = path.join(directory, 'artifacts');
        await mkdir(outputDirectory, { recursive: true });
        log.info(`DevTools local output directory: ${outputDirectory}`);
        this.gateway = new DevtoolsGateway();
        await this.gateway.start(this.createProcess('Chrome DevTools MCP'), devtools, endpoint, signal, log, [...this.fileRoots, outputDirectory]);
      }
      signal.throwIfAborted();
      this.ready = true;
    } finally { clearTimeout(timeout); }
  }
  protected makeProcess(name: string): ManagedProcess { return new ManagedProcess(name, this.log); }
  protected makeChrome(): DedicatedChrome { return new DedicatedChrome(this.log); }
  private createProcess(name: string): ManagedProcess {
    const child = this.makeProcess(name);
    this.processes.push(child);
    child.on('failure', (error: Error) => {
      if (this.abort.signal.aborted || this.failed) return;
      this.failed = true;
      this.abort.abort(error);
      this.onFailure(error);
    });
    return child;
  }
  stop(): Promise<void> { return this.stopTask ??= this.stopInternal(); }
  private async stopInternal(): Promise<void> {
    this.abort.abort(new Error('Browser MCP stopped.'));
    // Kill workers first; this also unblocks pending MCP requests during startup.
    await Promise.all(this.processes.map(process => process.stop()));
    await this.startup?.catch(() => {});
    await this.gateway?.stop();
    await this.chrome?.stop(!this.ready);
    this.log.info('All owned MCP processes stopped.');
  }
}
