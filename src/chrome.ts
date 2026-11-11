import { spawn, ChildProcess } from 'node:child_process';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { findExecutable } from './command';
import { Configuration } from './config';
import { Log } from './logger';
import { killTree } from './watchdog';

export async function prepareProfile(directory: string): Promise<void> {
  if (!path.isAbsolute(directory)) throw new Error('browser.userDataDir must be an absolute path on the local computer.');
  await mkdir(directory, { recursive: true });
  const marker = 'browser-mcp-profile.json';
  const entries = await readdir(directory);
  if (entries.length && !entries.includes(marker)) throw new Error('Choose an empty browser.userDataDir. Existing Chrome profiles cannot be adopted.');
  if (entries.includes(marker)) {
    const data = JSON.parse(await readFile(path.join(directory, marker), 'utf8'));
    if (data.owner !== 'browser-mcp-debug') throw new Error('Chrome profile ownership marker is invalid.');
  } else await writeFile(path.join(directory, marker), JSON.stringify({ owner: 'browser-mcp-debug' }), { flag: 'wx' });
}

export async function profileEndpoint(directory: string, signal: AbortSignal): Promise<{ url: string; websocket: string }> {
  try { return await activePortEndpoint(directory, signal); }
  catch (original) {
    signal.throwIfAborted();
    const saved = await readFile(path.join(directory, 'browser-mcp-endpoint.json'), 'utf8').then(value => JSON.parse(value) as { url: string; websocket: string }).catch(() => { throw original; });
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(saved.url) || !saved.websocket.startsWith(saved.url.replace('http:', 'ws:') + '/devtools/browser/')) throw new Error('Invalid dedicated browser endpoint.');
    const response = await fetch(`${saved.url}/json/version`, { signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]) });
    const version = await response.json() as { webSocketDebuggerUrl?: string };
    if (version.webSocketDebuggerUrl !== saved.websocket) throw new Error('Chrome endpoint identity does not match its dedicated profile.');
    return saved;
  }
}

async function activePortEndpoint(directory: string, signal: AbortSignal): Promise<{ url: string; websocket: string }> {
  const [port, browserPath] = (await readFile(path.join(directory, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535 || !browserPath?.startsWith('/devtools/browser/')) throw new Error('Invalid Chrome debugging endpoint.');
  const url = `http://127.0.0.1:${port}`;
  const response = await fetch(`${url}/json/version`, { signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]) });
  if (!response.ok) throw new Error('Chrome debugging endpoint is unavailable.');
  const version = await response.json() as { webSocketDebuggerUrl?: string };
  const websocket = `ws://127.0.0.1:${port}${browserPath}`;
  if (version.webSocketDebuggerUrl !== websocket) throw new Error('Chrome endpoint identity does not match its dedicated profile.');
  return { url, websocket };
}

async function browserArguments(websocket: string, signal: AbortSignal): Promise<string[]> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(websocket);
    const finish = (error?: Error, args?: string[]) => { clearTimeout(timer); signal.removeEventListener('abort', abort); socket.terminate(); error ? reject(error) : resolve(args!); };
    const abort = () => finish(new Error('Chrome connection cancelled.'));
    const timer = setTimeout(() => finish(new Error('Chrome ownership check timed out.')), 3000);
    signal.addEventListener('abort', abort, { once: true });
    socket.once('error', error => finish(error));
    socket.once('open', () => socket.send(JSON.stringify({ id: 1, method: 'Browser.getBrowserCommandLine' })));
    socket.once('message', data => {
      try {
        const result = JSON.parse(data.toString());
        if (!Array.isArray(result.result?.arguments)) throw new Error('Chrome did not provide its launch arguments.');
        finish(undefined, result.result.arguments);
      } catch (error) { finish(error as Error); }
    });
  });
}

export class DedicatedChrome {
  private endpoint?: { url: string; websocket: string };
  private directory?: string;
  private created = false;
  private child?: ChildProcess;
  constructor(private readonly log: Log) {}
  async start(options: Configuration['browser'], defaultDirectory: string, signal: AbortSignal, debuggerPort?: number): Promise<string> {
    const directory = options.userDataDir ?? defaultDirectory;
    await prepareProfile(directory);
    this.directory = directory;
    signal.throwIfAborted();
    if (debuggerPort) {
      while (true) {
        signal.throwIfAborted();
        try {
          const url = `http://127.0.0.1:${debuggerPort}`;
          const response = await fetch(`${url}/json/version`, { signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]) });
          const version = await response.json() as { webSocketDebuggerUrl: string };
          if (!version.webSocketDebuggerUrl?.startsWith(`ws://127.0.0.1:${debuggerPort}/devtools/browser/`)) throw new Error('Invalid debugger-owned Chrome endpoint.');
          const args = await browserArguments(version.webSocketDebuggerUrl, signal);
          const profile = args.find(arg => arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
          const normalize = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
          if (!profile || normalize(profile) !== normalize(directory)) throw new Error('Chrome debugger profile does not match the dedicated profile.');
          this.endpoint = { url, websocket: version.webSocketDebuggerUrl };
          await writeFile(path.join(directory, 'browser-mcp-endpoint.json'), JSON.stringify(this.endpoint));
          break;
        }
        catch { signal.throwIfAborted(); }
        await delay(150, undefined, { signal });
      }
      this.log.info(`Debugger-owned dedicated Chrome ready: ${this.endpoint.url}; profile: ${directory}`);
      return this.endpoint.url;
    }
    const existing = await profileEndpoint(directory, signal).catch(() => undefined);
    if (existing) {
      throw new Error('Dedicated Chrome is already using this profile. Stop its debug session or close that dedicated Chrome first.');
    }
    let executable = options.executablePath;
    if (!executable) {
      const candidates = process.platform === 'win32' ? [
        path.join(process.env.PROGRAMFILES ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
        path.join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe')
      ] : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] : [];
      for (const candidate of candidates) {
        if (await access(candidate).then(() => true, () => false)) { executable = candidate; break; }
      }
      executable ??= await findExecutable('google-chrome');
    }
    await access(executable);
    signal.throwIfAborted();
    const child = spawn(executable, [
      `--user-data-dir=${directory}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
      '--no-first-run', '--no-default-browser-check', '--disable-crash-reporter', 'about:blank'
    ], { detached: true, windowsHide: false, stdio: 'ignore', shell: false });
    this.child = child;
    this.created = true;
    let error: Error | undefined;
    child.on('error', value => { error = value; });
    child.unref();
    while (true) {
      signal.throwIfAborted();
      if (error) throw error;
      try { this.endpoint = await profileEndpoint(directory, signal); break; } catch { signal.throwIfAborted(); }
      if (child.exitCode !== null) throw new Error(`Chrome exited before its debugging endpoint became ready (${child.exitCode}).`);
      await delay(150, undefined, { signal });
    }
    this.log.info(`Dedicated Chrome ready: ${this.endpoint.url}; profile: ${directory}`);
    return this.endpoint.url;
  }
  async stop(onlyCreated = false): Promise<void> {
    if (!this.directory || (onlyCreated && !this.created)) return;
    // Revalidate identity before closing: a port may have been reused.
    const current = await profileEndpoint(this.directory, new AbortController().signal).catch(() => undefined);
    if (!current) {
      if (this.child?.pid && this.child.exitCode === null && this.child.signalCode === null) await killTree(this.child.pid);
      return;
    }
    if ((this.endpoint && current.websocket !== this.endpoint.websocket) || (!this.endpoint && !this.created)) return;
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(current.websocket);
      const timer = setTimeout(() => { socket.terminate(); reject(new Error('Dedicated Chrome shutdown timed out.')); }, 5000);
      const finish = () => { clearTimeout(timer); socket.terminate(); resolve(); };
      socket.once('open', () => socket.send(JSON.stringify({ id: 1, method: 'Browser.close' })));
      socket.once('close', finish);
      socket.once('error', finish);
    });
    this.log.info('Dedicated Chrome closed.');
  }
}
