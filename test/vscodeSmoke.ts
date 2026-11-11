import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { access, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { profileEndpoint } from '../src/chrome';
import { chromium } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

function sessionEvent(event: vscode.Event<vscode.DebugSession>, predicate: (session: vscode.DebugSession) => boolean): Promise<vscode.DebugSession> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { listener.dispose(); reject(new Error('VS Code debug session event timed out.')); }, 20000);
    const listener = event(session => { if (predicate(session)) { clearTimeout(timer); listener.dispose(); resolve(session); } });
  });
}

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('mm-lab.browser-mcp-debug');
  assert.ok(extension, 'development extension discovered');
  await extension.activate();
  assert.equal(extension.extensionKind, vscode.ExtensionKind.UI);
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder);
  for (const [enabled, stopParent] of [[false, false], [false, true], [true, false], [true, true]]) {
    const profileDirectory = path.resolve(folder.uri.fsPath, `../../../.tmp/vscode-smoke-chrome/${enabled}-${stopParent}`);
    const pwPort = await freePort(), dtPort = await freePort();
    const parentStarted = sessionEvent(vscode.debug.onDidStartDebugSession, session => session.type === 'browser-mcp');
    const childStarted = sessionEvent(vscode.debug.onDidStartDebugSession, session => session.name === 'Smoke target');
    assert.equal(await vscode.debug.startDebugging(folder, {
      type: 'browser-mcp', name: 'Smoke orchestration', request: 'launch', target: 'Smoke target',
      playwrightMcp: { enabled, command: process.env.BROWSER_MCP_SMOKE_NPX, package: 'fixture-playwright', port: pwPort },
      chromeDevtoolsMcp: { enabled, command: process.env.BROWSER_MCP_SMOKE_NPX, package: 'fixture-devtools', port: dtPort },
      browser: { userDataDir: profileDirectory }
    }), true);
    const parent = await parentStarted;
    const child = await childStarted;
    assert.equal(child.parentSession?.id, parent.id, 'target has Browser MCP parent');
    await profileEndpoint(profileDirectory, AbortSignal.timeout(3000));
    if (enabled) {
      for (const port of [pwPort, dtPort]) {
        const client = new Client({ name: 'vscode-smoke', version: '1.0.0' });
        try {
          await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
          assert.ok((await client.listTools()).tools.length > 0);
        } finally { await client.close(); }
      }
    }
    const parentEnded = sessionEvent(vscode.debug.onDidTerminateDebugSession, session => session.id === parent.id);
    const childEnded = sessionEvent(vscode.debug.onDidTerminateDebugSession, session => session.id === child.id);
    await vscode.debug.stopDebugging(stopParent ? parent : child);
    await Promise.all([parentEnded, childEnded]);
    let chromeClosed = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { await profileEndpoint(profileDirectory, AbortSignal.timeout(1000)); }
      catch { chromeClosed = true; break; }
      await delay(100);
    }
    assert.ok(chromeClosed, 'dedicated Chrome stops automatically without lifecycle settings');
    await access(path.join(profileDirectory, 'browser-mcp-profile.json'));
    if (enabled) {
      // Parent termination follows cleanup, so both listeners must be gone.
      await assert.rejects(fetch(`http://127.0.0.1:${pwPort}/mcp`));
      await assert.rejects(fetch(`http://127.0.0.1:${dtPort}/mcp`));
    }
  }
  // A real Chrome debugger must share its browser with MCP, retain its tasks,
  // and still stop at source breakpoints. No second Chrome is launched.
  for (const stopParent of [false, true]) {
    const profileDirectory = path.resolve(folder.uri.fsPath, `../../../.tmp/vscode-smoke-chrome/shared-${stopParent}`);
    const preMarker = path.resolve(folder.uri.fsPath, '../../../.tmp/chrome-prelaunch');
    const postMarker = path.resolve(folder.uri.fsPath, '../../../.tmp/chrome-postdebug');
    await Promise.all([rm(preMarker, { force: true }), rm(postMarker, { force: true })]);
    const breakpoint = new vscode.SourceBreakpoint(new vscode.Location(vscode.Uri.joinPath(folder.uri, 'browser.js'), new vscode.Position(1, 0)));
    vscode.debug.addBreakpoints([breakpoint]);
    let childId: string | undefined;
    let stoppedResolve!: (threadId: number) => void;
    const stopped = new Promise<number>(resolve => { stoppedResolve = resolve; });
    const tracker = vscode.debug.registerDebugAdapterTrackerFactory('*', {
      createDebugAdapterTracker(session) {
        return { onDidSendMessage(message) {
          let ancestor: vscode.DebugSession | undefined = session;
          while (ancestor && ancestor.id !== childId) ancestor = ancestor.parentSession;
          if (message.event === 'stopped') console.log('SHARED_CHROME_STOP', session.name, message.body?.reason, Boolean(ancestor));
          if (ancestor && message.event === 'stopped' && message.body?.reason === 'breakpoint') stoppedResolve(message.body.threadId);
        } };
      }
    });
    const pwPort = await freePort(), dtPort = await freePort();
    const parentStarted = sessionEvent(vscode.debug.onDidStartDebugSession, session => session.type === 'browser-mcp');
    const childStarted = sessionEvent(vscode.debug.onDidStartDebugSession, session => session.name === 'Smoke Chrome');
    let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
    let parent: vscode.DebugSession | undefined;
    try {
      assert.equal(await vscode.debug.startDebugging(folder, {
        type: 'browser-mcp', name: 'Shared Chrome orchestration', request: 'launch', target: 'Smoke Chrome',
        browser: { userDataDir: profileDirectory },
        playwrightMcp: { command: process.env.BROWSER_MCP_SMOKE_NPX, package: 'fixture-playwright', port: pwPort },
        chromeDevtoolsMcp: { command: process.env.BROWSER_MCP_SMOKE_NPX, package: 'fixture-devtools', port: dtPort }
      }), true);
      parent = await parentStarted;
      const child = await childStarted; childId = child.id;
      assert.equal(child.parentSession?.id, parent.id);
      assert.equal(child.configuration.userDataDir, profileDirectory);
      await access(preMarker);
      const endpoint = await profileEndpoint(profileDirectory, AbortSignal.timeout(3000));
      browser = await chromium.connectOverCDP(endpoint.url);
      const page = browser.contexts()[0].pages().find(page => page.url().includes('browser.html'));
      assert.ok(page, 'debugger navigates the shared browser to the configured file');
      await page.waitForFunction(() => typeof (window as any).sharedBrowserSmoke === 'function');
      const result = page.evaluate(() => (window as any).sharedBrowserSmoke());
      const threadId = await Promise.race([stopped, delay(10000).then(() => { throw new Error('Shared Chrome source breakpoint did not fire.'); })]);
      const active = vscode.debug.activeDebugSession ?? child;
      await active.customRequest('continue', { threadId });
      assert.equal(await result, 42);
      await browser.close(); browser = undefined;
      const parentEnded = sessionEvent(vscode.debug.onDidTerminateDebugSession, session => session.id === parent!.id);
      const childEnded = sessionEvent(vscode.debug.onDidTerminateDebugSession, session => session.id === child.id);
      await vscode.debug.stopDebugging(stopParent ? parent : child);
      await Promise.all([parentEnded, childEnded]);
      for (let attempt = 0; attempt < 50; attempt++) {
        if (await access(postMarker).then(() => true, () => false)) break;
        await delay(100);
      }
      await access(postMarker);
      await assert.rejects(fetch(`http://127.0.0.1:${pwPort}/mcp`));
      await assert.rejects(fetch(`http://127.0.0.1:${dtPort}/mcp`));
      await assert.rejects(profileEndpoint(profileDirectory, AbortSignal.timeout(1000)));
    } finally {
      tracker.dispose(); vscode.debug.removeBreakpoints([breakpoint]);
      await browser?.close();
      if (parent) await vscode.debug.stopDebugging(parent);
    }
  }
  console.log('BROWSER_MCP_VSCODE_SMOKE_OK: local UI extension; real Node target; child/parent stops; packaged MCP supervision and HTTP cleanup');
}
