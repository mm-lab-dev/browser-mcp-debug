const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { setTimeout: delay } = require('node:timers/promises');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const sample = path.join(root, 'samples', 'angular-demo');
const directory = path.join(root, '.tmp', 'angular-demo');
const artifactDirectory = path.join(root, 'artifacts', 'angular-demo');
const statePath = path.join(directory, 'state.json');
const url = 'http://127.0.0.1:4201';
const chromeProfile = path.join(directory, 'extension-chrome-profile');
async function chromeEndpoint() {
  const { profileEndpoint } = require('../out/src/chrome');
  return (await profileEndpoint(chromeProfile, AbortSignal.timeout(3000))).url;
}

function launch(executable, args, filename, env, visible = false) {
  const fd = fs.openSync(path.join(directory, filename), 'a');
  try {
    const child = spawn(executable, args, {
      cwd: sample, env, detached: true, windowsHide: !visible,
      stdio: ['ignore', fd, fd], shell: false
    });
    child.on('error', error => console.error(error.message));
    child.unref();
    return child;
  } finally { fs.closeSync(fd); }
}
async function waitFor(check, description, timeout = 180000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    if (description === 'Browser MCP debug startup' && fs.existsSync(path.join(directory, 'error.txt'))) {
      throw new Error(fs.readFileSync(path.join(directory, 'error.txt'), 'utf8'));
    }
    try { if (await check()) return; } catch (error) { lastError = error; }
    await delay(400);
  }
  throw new Error(`${description} timed out. ${lastError || ''} See ${directory}`);
}
async function free(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`Port ${port} is in use. Stop the existing owner before starting this demo.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
async function connect(port) {
  const client = new Client({ name: 'angular-live-demo', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)), { timeout: 20000 });
  return client;
}
async function tool(client, name, args) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
  if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.content)}`);
  return result;
}
async function check() {
  fs.mkdirSync(artifactDirectory, { recursive: true });
  const evidence = { connectionMode: "shared-debugger-chrome", url, checkedAt: new Date().toISOString(), checks: [] };
  const pw = await connect(8931);
  const dt = await connect(8932);
  let browser;
  try {
    const playwrightTools = await pw.listTools();
    const devtoolsTools = await dt.listTools();
    evidence.playwrightTools = playwrightTools.tools.map(item => item.name);
    evidence.devtoolsTools = devtoolsTools.tools.map(item => item.name);
    browser = await chromium.connectOverCDP(await chromeEndpoint());
    const context = browser.contexts()[0];
    const page = context.pages().find(item => item.url().startsWith(url));
    if (!page) throw new Error('Angular page not found in the demo Chrome.');
    evidence.checks.push('Chrome debugger opened the Angular URL before any MCP navigation');
    await tool(pw, 'browser_navigate', { url });
    evidence.checks.push('Playwright MCP navigated the same debugger-owned Chrome');
    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.getByRole('heading', { name: 'See your changes in action.' }).waitFor();
    // Reload makes checks repeatable, without persistence or user account changes.
    await page.reload();
    const responseErrors = [];
    page.on('pageerror', error => responseErrors.push(error.message));
    await page.getByTestId('total-count').waitFor();
    await page.screenshot({ path: path.join(artifactDirectory, 'angular-demo-before.png'), fullPage: true });
    const interactions = evidence.playwrightInteraction = [];
    async function interact(name, args) { interactions.push({ name, result: await tool(pw, name, args) }); }
    await interact('browser_click', { target: '[role="checkbox"][aria-label="Mark a task complete and watch it update"]' });
    await page.waitForFunction(() => document.querySelector('[data-testid="done-count"]')?.textContent?.trim() === '2');
    const breakpointPath = path.join(directory, 'angular-breakpoint.json');
    await waitFor(async () => fs.existsSync(breakpointPath), 'Angular TypeScript breakpoint verification', 10000);
    evidence.breakpoint = JSON.parse(fs.readFileSync(breakpointPath, 'utf8'));
    evidence.checks.push('VS Code stopped at an Angular TypeScript breakpoint in the same MCP-controlled Chrome');
    await interact('browser_type', { target: '#task-title', text: 'Demo task added through MCP' });
    await interact('browser_click', { target: '.add-task button' });
    await page.getByRole('checkbox', { name: 'Demo task added through MCP' }).waitFor();
    await interact('browser_click', { target: 'button[aria-label="Write a Console log"]' });
    const response = page.waitForResponse(value => value.url().includes('/demo-data.json'));
    await interact('browser_click', { target: 'button[aria-label="Send an API request"]' });
    if ((await response).status() !== 200) throw new Error('Sample API request failed.');
    await page.getByTestId('last-event').filter({ hasText: '200' }).waitFor();
    evidence.checks.push('Playwright MCP toggled a task, created a task, emitted a Console log and fetched JSON');
    const pages = await tool(dt, 'list_pages', {});
    const pageListing = pages.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
    const pageId = Number(pageListing.match(/^(\d+):.*127\.0\.0\.1:4201/m)?.[1]);
    if (!Number.isFinite(pageId)) throw new Error('DevTools MCP did not find an Angular page ID.');
    const consoleMessages = await tool(dt, 'list_console_messages', { pageId });
    const networkRequests = await tool(dt, 'list_network_requests', { pageId });
    evidence.pages = pages;
    evidence.console = consoleMessages;
    evidence.network = networkRequests;
    evidence.pageErrors = responseErrors;
    if (responseErrors.length) throw new Error(`Browser errors: ${responseErrors.join('; ')}`);
    if (!JSON.stringify(pages).includes('4201')) throw new Error('DevTools MCP did not find the Angular page.');
    if (!JSON.stringify(consoleMessages).includes('console.check')) throw new Error('DevTools MCP did not observe the Console log.');
    if (!JSON.stringify(networkRequests).includes('demo-data.json')) throw new Error('DevTools MCP did not observe the JSON request.');
    evidence.checks.push('Chrome DevTools MCP observed the same Angular page, Console and Network');
    await page.screenshot({ path: path.join(artifactDirectory, 'angular-demo-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(artifactDirectory, 'angular-demo-mobile.png'), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) throw new Error('Mobile viewport has horizontal overflow.');
    evidence.checks.push('Desktop and mobile screenshots captured; no mobile horizontal overflow');
    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.bringToFront();
    fs.writeFileSync(path.join(artifactDirectory, 'verification.json'), JSON.stringify(evidence, null, 2));
    console.log(`VERIFIED: ${evidence.checks.length} checks; screenshots and MCP evidence in ${artifactDirectory}`);
  } finally {
    await browser?.close(); // Disconnect from existing Chrome; leave its window open.
    await Promise.allSettled([pw.close(), dt.close()]);
  }
}
async function stop() {
  if (!fs.existsSync(statePath)) { console.log('No demo state exists.'); return; }
  fs.writeFileSync(path.join(directory, 'stop'), 'stop');
  await waitFor(async () => {
    try { await free(4201); await free(8931); await free(8932); return true; } catch { return false; }
  }, 'Debug and MCP cleanup', 20000);
  fs.mkdirSync(artifactDirectory, { recursive: true });
  fs.writeFileSync(path.join(artifactDirectory, 'cleanup-verification.json'), JSON.stringify({
    checkedAt: new Date().toISOString(), releasedPorts: [4201, 8931, 8932],
    method: 'VS Code parent stop; extension automatically closes dedicated Chrome'
  }, null, 2));
  await waitFor(async () => { try { await chromeEndpoint(); return false; } catch { return true; } }, 'Extension-owned Chrome cleanup', 10000);
  console.log('STOPPED: Angular dev server, both MCPs and extension-owned Chrome.');
}

async function start() {
  fs.mkdirSync(directory, { recursive: true });
  for (const port of [4201, 8931, 8932]) await free(port);
  for (const filename of ['stop', 'debug-started.json', 'angular-breakpoint.json', 'error.txt']) {
    const file = path.join(directory, filename);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  if (!fs.existsSync(path.join(sample, 'node_modules', '@angular', 'cli'))) throw new Error('Run npm run demo:angular:install first.');
  const code = process.env.BROWSER_MCP_CODE_EXECUTABLE || path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe');
  const temporary = path.join(root, '.tmp');
  const env = {
    ...process.env, TEMP: temporary, TMP: temporary, TMPDIR: temporary,
    npm_config_cache: path.join(root, '.cache', 'npm'),
    NG_CLI_ANALYTICS: 'false', NODE_DISABLE_COMPILE_CACHE: '1',
    PLAYWRIGHT_MCP_OUTPUT_DIR: path.join(directory, 'playwright-output'),
    CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: '1', CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1',
    BROWSER_MCP_ANGULAR_DEMO_DIR: directory
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VSCODE_IPC_HOOK_CLI;
  const vscodeProcess = launch(code, [
    '--extensionDevelopmentPath=' + root,
    '--extensionTestsPath=' + path.join(root, 'out', 'test', 'angularDemo.js'),
    '--user-data-dir=' + path.join(directory, 'vscode-user'),
    '--extensions-dir=' + path.join(directory, 'vscode-extensions'),
    '--crash-reporter-directory=' + path.join(directory, 'crashes'),
    '--disable-crash-reporter', '--disable-telemetry', '--disable-updates',
    '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', sample
  ], 'vscode.log', env, true);
  vscodeProcess.once('error', error => fs.writeFileSync(path.join(directory, 'error.txt'), `VS Code launch failed: ${error.message}`));
  vscodeProcess.once('exit', code => {
    if (code && !fs.existsSync(path.join(directory, 'debug-started.json'))) {
      fs.writeFileSync(path.join(directory, 'error.txt'), `VS Code exited (${code}). See ${path.join(directory, 'vscode.log')}`);
    }
  });
  fs.writeFileSync(statePath, JSON.stringify({ chromeProfile, connectionMode: "shared-debugger-chrome", vscodePid: vscodeProcess.pid, sample }, null, 2));
  await waitFor(async () => {
    if (fs.existsSync(path.join(directory, 'error.txt'))) throw new Error(fs.readFileSync(path.join(directory, 'error.txt'), 'utf8'));
    return fs.existsSync(path.join(directory, 'debug-started.json'));
  }, 'Browser MCP debug startup');
  await waitFor(async () => (await fetch(url)).ok, 'Angular dev server');
  await check();
  console.log(`RUNNING: ${url}\nVS Code and Chrome are open. Use Stop in the debug toolbar, or run npm run demo:angular:stop.`);
}
const action = process.argv[2] || 'start';
({ start, check, stop }[action] || (() => { throw new Error('Use start, check or stop.'); }))().catch(error => { console.error(error); process.exitCode = 1; });
