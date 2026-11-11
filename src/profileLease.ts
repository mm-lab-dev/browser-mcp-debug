import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import { prepareProfile } from './chrome';

/** A filesystem lease coordinates separate local Extension Hosts as well. */
export class ProfileLease {
  private releaseLock?: () => Promise<void>;
  constructor(private readonly directory: string, private readonly onFailure: (error: Error) => void) {}
  async acquire(): Promise<void> {
    if (!path.isAbsolute(this.directory)) throw new Error('browser.userDataDir must be an absolute path on the local computer.');
    await mkdir(this.directory, { recursive: true });
    try {
      this.releaseLock = await lockfile.lock(this.directory, { onCompromised: this.onFailure });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ELOCKED') throw new Error('Dedicated Chrome profile is in use by another Browser MCP session. Stop it or choose a different browser.userDataDir.');
      throw error;
    }
    try { await prepareProfile(this.directory); }
    catch (error) { await this.release(); throw error; }
  }
  async release(): Promise<void> {
    const release = this.releaseLock;
    this.releaseLock = undefined;
    await release?.();
  }
}
