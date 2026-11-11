export interface McpOptions {
  enabled: boolean;
  command: string;
  package: string;
  port: number;
}
export interface Settings {
  playwright: McpOptions;
  devtools: McpOptions;
  startupTimeout: number;
}
export interface Configuration {
  target: string;
  browser: { executablePath?: string; userDataDir?: string };
  playwright: McpOptions;
  devtools: McpOptions;
  startupTimeout: number;
}
function object(value: unknown, name: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value as Record<string, unknown>;
}
function bool(value: unknown, fallback: boolean, name: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${name} must be boolean.`);
  return value;
}
function text(value: unknown, fallback: string, name: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  return value;
}
function port(value: unknown, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || Number(result) < 1024 || Number(result) > 65535) throw new Error(`${name} must be an integer from 1024 to 65535.`);
  return result as number;
}
function mcp(value: Record<string, unknown>, defaults: McpOptions, name: string): McpOptions {
  return {
    enabled: bool(value.enabled, defaults.enabled, `${name}.enabled`),
    command: text(value.command, defaults.command, `${name}.command`),
    package: text(value.package, defaults.package, `${name}.package`),
    port: port(value.port, defaults.port, `${name}.port`)
  };
}
export function parseConfiguration(raw: Record<string, unknown>, settings: Settings): Configuration {
  const browser = object(raw.browser, 'browser');
  if (browser.type !== undefined && browser.type !== 'chrome') throw new Error('MVP supports browser.type="chrome" only.');
  if ('launch' in browser || 'closeOnStop' in browser) throw new Error('Remove browser.launch and browser.closeOnStop. Dedicated Chrome starts and stops automatically.');
  if (browser.profile !== undefined) throw new Error('Use browser.userDataDir for a dedicated profile.');
  const pw = object(raw.playwrightMcp, 'playwrightMcp');
  const dt = object(raw.chromeDevtoolsMcp, 'chromeDevtoolsMcp');
  if ('cdpEndpoint' in pw || 'browserUrl' in dt || 'autoConnect' in dt) throw new Error('Existing Chrome connection settings are not supported. Dedicated Chrome supplies both MCP connections automatically.');
  const result: Configuration = {
    target: text(raw.target, '', 'target'),
    browser: {
      executablePath: browser.executablePath === undefined ? undefined : text(browser.executablePath, '', 'browser.executablePath'),
      userDataDir: browser.userDataDir === undefined ? undefined : text(browser.userDataDir, '', 'browser.userDataDir') },
    playwright: mcp(pw, settings.playwright, 'playwrightMcp'),
    devtools: mcp(dt, settings.devtools, 'chromeDevtoolsMcp'),
    startupTimeout: Number(raw.startupTimeout ?? settings.startupTimeout)
  };
  if (!result.target) throw new Error('target is required.');
  if (!Number.isInteger(result.startupTimeout) || result.startupTimeout < 1000 || result.startupTimeout > 300000) throw new Error('startupTimeout must be 1000–300000 ms.');
  if (result.playwright.enabled && result.devtools.enabled && result.playwright.port === result.devtools.port) throw new Error('MCP ports must be different.');
  return result;
}
