import { Configuration } from './config';
import { prepareProfile, profileEndpoint } from './chrome';
import net from 'node:net';

export interface TargetConfiguration {
  type: string;
  request?: string;
  [key: string]: unknown;
}

export function isChromeLaunch(target: TargetConfiguration): boolean {
  return ['chrome', 'pwa-chrome'].includes(target.type) && target.request === 'launch';
}

/** Keep VS Code's URL, tasks and source mapping; share only its dedicated browser. */
export async function sharedChromeTarget<T extends TargetConfiguration>(target: T, browser: Configuration['browser'], defaultDirectory: string): Promise<T & { port: number }> {
  const directory = browser.userDataDir ?? defaultDirectory;
  await prepareProfile(directory);
  if (await profileEndpoint(directory, AbortSignal.timeout(2000)).then(() => true, () => false)) throw new Error('Dedicated Chrome is already using this profile. Stop its debug session or close that dedicated Chrome before starting the Chrome debugger.');
  const args = target.runtimeArgs ?? [];
  if (!Array.isArray(args) || args.some(value => typeof value !== 'string')) throw new Error('Chrome target runtimeArgs must be an array of strings.');
  // The debugger and both MCP servers must use the same dedicated profile and
  // loopback CDP endpoint, rather than the debugger's default pipe connection.
  const runtimeArgs: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (/^--(?:remote-debugging-|user-data-dir(?:=|$)|profile-directory(?:=|$))/.test(arg)) {
      if (!arg.includes('=') && arg !== '--remote-debugging-pipe' && args[index + 1] && !args[index + 1].startsWith('--')) index++;
    } else runtimeArgs.push(arg);
  }
  // VS Code's UI browser companion requires a concrete CDP port.
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  runtimeArgs.push(`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--enable-automation');
  return {
    ...target,
    ...(browser.executablePath ? { runtimeExecutable: browser.executablePath } : {}),
    userDataDir: directory,
    browserLaunchLocation: 'ui',
    cleanUp: 'wholeBrowser',
    port,
    runtimeArgs
  };
}
