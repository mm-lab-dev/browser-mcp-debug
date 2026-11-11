import { Configuration } from './config';
import { Log } from './logger';

export interface RuntimeControl { start(): Promise<void>; stop(): Promise<void>; }
export interface DebugHost {
  prepare?(): Promise<void>;
  release?(): Promise<void>;
  targetOwnsBrowser?: boolean;
  startTarget(): Promise<boolean>;
  stopTargets(): Promise<void>;
  report(error: Error): void;
}
export interface DapMessage {
  seq: number;
  type: string;
  command?: string;
  arguments?: Record<string, unknown>;
}
export interface Lease { acquire(owner: object): boolean; release(owner: object): void; }
export class SingleRunLease implements Lease {
  private owner?: object;
  acquire(owner: object): boolean {
    if (this.owner && this.owner !== owner) return false;
    this.owner = owner; return true;
  }
  release(owner: object): void { if (this.owner === owner) this.owner = undefined; }
}

/** DAP orchestration kept independent of VS Code so cancellation is testable. */
export class DebugController {
  private sequence = 1;
  private stopped = false;
  private terminated = false;
  private launching?: Promise<void>;
  private cleanup?: Promise<void>;
  private runtime?: RuntimeControl;
  private preparation?: Promise<void>;
  constructor(
    private readonly emit: (message: object) => void,
    private readonly host: DebugHost,
    private readonly lease: Lease,
    private readonly createRuntime: (config: Configuration, onFailure: (error: Error) => void) => RuntimeControl,
    private readonly config: Configuration,
    private readonly log: Log
  ) {}
  handle(message: DapMessage): void {
    if (message.type !== 'request') return;
    switch (message.command) {
      case 'initialize':
        this.respond(message, true, { supportsTerminateRequest: true });
        this.event('initialized'); break;
      case 'launch':
        if (this.launching || this.stopped) { this.respond(message, false, undefined, 'Session already started or stopped.'); break; }
        this.launching = this.launch(message); break;
      case 'disconnect': case 'terminate':
        void this.stop().then(() => this.respond(message), error => this.respond(message, false, undefined, String(error))); break;
      case 'configurationDone': case 'setExceptionBreakpoints': this.respond(message); break;
      case 'threads': this.respond(message, true, { threads: [] }); break;
      case 'setBreakpoints': this.respond(message, true, { breakpoints: [] }); break;
      default: this.respond(message, false, undefined, `Unsupported request: ${message.command}`);
    }
  }
  private async launch(request: DapMessage): Promise<void> {
    try {
      if (!this.lease.acquire(this)) throw new Error('Browser MCP is already running in this window. Stop the existing session first.');
      if (this.host.prepare) {
        this.preparation = this.host.prepare();
        await this.preparation;
      }
      if (this.stopped) throw new Error('Startup cancelled.');
      this.runtime = this.createRuntime(this.config, error => {
        this.host.report(error); void this.stop();
      });
      if (!this.host.targetOwnsBrowser) await this.runtime.start();
      if (this.stopped) throw new Error('Startup cancelled.');
      const started = await this.host.startTarget();
      if (!started) throw new Error(`Could not start target "${this.config.target}". Check its debug configuration and preLaunchTask.`);
      if (this.stopped) {
        await this.host.stopTargets();
        throw new Error('Startup cancelled.');
      }
      if (this.host.targetOwnsBrowser) await this.runtime.start();
      if (this.stopped) throw new Error('Startup cancelled.');
      this.respond(request);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.log.error(failure.message);
      if (!this.stopped) this.host.report(failure);
      this.respond(request, false, undefined, failure.message);
      await this.stop();
    }
  }
  targetEnded(): void { void this.stop(); }
  stop(): Promise<void> {
    this.stopped = true;
    return this.cleanup ??= this.stopInternal();
  }
  private async stopInternal(): Promise<void> {
    try {
      // Starting a target may still be waiting for a preLaunchTask. Keep the
      // session association alive, and stop any child as soon as it appears.
      await this.preparation?.catch(() => {});
      await Promise.all([this.host.stopTargets(), this.runtime?.stop()]);
    } catch (error) { this.log.error(String(error)); }
    finally {
      try { await this.host.release?.(); } catch (error) { this.log.error(String(error)); }
      this.lease.release(this);
      if (!this.terminated) { this.terminated = true; this.event('terminated'); }
    }
  }
  get isStopped(): boolean { return this.stopped; }
  async waitForLaunch(): Promise<void> { await this.launching; }
  private respond(request: DapMessage, success = true, body?: object, message?: string): void {
    this.emit({ seq: this.sequence++, type: 'response', request_seq: request.seq, command: request.command, success, body, message });
  }
  private event(event: string): void { this.emit({ seq: this.sequence++, type: 'event', event }); }
}
