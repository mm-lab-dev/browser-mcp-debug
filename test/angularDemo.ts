import * as vscode from 'vscode';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/** Interactive integration harness: stay open until the debug session stops. */
export async function run(): Promise<void> {
  const directory = process.env.BROWSER_MCP_ANGULAR_DEMO_DIR;
  if (!directory) throw new Error('Start with npm run demo:angular.');
  const extension = vscode.extensions.getExtension('mm-lab.browser-mcp-debug');
  if (!extension) throw new Error('Browser MCP extension was not loaded.');
  await extension.activate();
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error('Angular sample workspace was not opened.');
  let parent: vscode.DebugSession | undefined;
  let server: vscode.DebugSession | undefined;
  let ended = false;
  const source = vscode.Uri.joinPath(folder.uri, 'src', 'main.ts');
  const lines = (await fs.readFile(source.fsPath, 'utf8')).split(/\r?\n/);
  const line = lines.findIndex(value => value.includes('this.tasks.update(tasks => tasks.map'));
  if (line < 0) throw new Error('Angular breakpoint location was not found.');
  const breakpoint = new vscode.SourceBreakpoint(new vscode.Location(source, new vscode.Position(line, 0)));
  vscode.debug.addBreakpoints([breakpoint]);
  let breakpointChecked = false;
  const subscriptions = [
    vscode.debug.registerDebugAdapterTrackerFactory('*', {
      createDebugAdapterTracker(session) {
        return { onDidSendMessage(message) {
          let ancestor: vscode.DebugSession | undefined = session;
          while (ancestor && ancestor.id !== parent?.id) ancestor = ancestor.parentSession;
          if (!ancestor || breakpointChecked || message.event !== 'stopped' || message.body?.reason !== 'breakpoint') return;
          breakpointChecked = true;
          void (async () => {
            try {
              const stack = await session.customRequest('stackTrace', { threadId: message.body.threadId, levels: 5 });
              if (!stack.stackFrames?.some((frame: any) => frame.source?.path?.replaceAll('\\', '/').endsWith('/src/main.ts'))) throw new Error('Breakpoint did not map to Angular TypeScript.');
              await fs.writeFile(path.join(directory, 'angular-breakpoint.json'), JSON.stringify({ source: source.fsPath, line: line + 1, sessionName: session.name, stackFrames: stack.stackFrames }, null, 2));
            } catch (error) { await fs.writeFile(path.join(directory, 'error.txt'), String(error)); }
            finally {
              vscode.debug.removeBreakpoints([breakpoint]);
              await session.customRequest('continue', { threadId: message.body.threadId });
            }
          })();
        } };
      }
    }),
    vscode.debug.onDidStartDebugSession(session => { if (session.name === 'Angular dev server') server = session; }),
    vscode.debug.onDidStartDebugSession(session => { if (session.type === 'browser-mcp') parent = session; }),
    vscode.debug.onDidTerminateDebugSession(session => { if (session.id === parent?.id) ended = true; })
  ];
  try {
    if (!await vscode.debug.startDebugging(folder, 'Angular dev server')) throw new Error('Angular dev server could not start.');
    const deadline = Date.now() + 120000;
    while (true) {
      const ready = await fetch('http://127.0.0.1:4201', { signal: AbortSignal.timeout(1500) }).then(response => response.ok, () => false);
      if (ready) break;
      if (Date.now() > deadline) throw new Error('Angular dev server did not become ready.');
      await delay(300);
    }
    const started = await vscode.debug.startDebugging(folder, 'Angular + Browser MCP');
    if (!started) throw new Error('Angular + Browser MCP could not start. See Output > Browser MCP.');
    if (!parent || 'launch' in (parent.configuration.browser ?? {}) || 'closeOnStop' in (parent.configuration.browser ?? {}) || parent.configuration.playwrightMcp?.cdpEndpoint || parent.configuration.chromeDevtoolsMcp?.browserUrl) {
      throw new Error('The demo must use extension-managed dedicated Chrome without preconfigured CDP endpoints.');
    }
    await vscode.commands.executeCommand('browserMcp.showOutput');
    await fs.writeFile(path.join(directory, 'debug-started.json'), JSON.stringify({ parentId: parent.id, browser: parent.configuration.browser, target: 'Angular browser', connectionMode: 'shared-debugger-chrome', time: new Date().toISOString() }));
    console.log('ANGULAR_DEMO_DEBUG_STARTED');
    while (!ended) {
      try {
        await fs.access(path.join(directory, 'stop'));
        if (parent) await vscode.debug.stopDebugging(parent);
      } catch { /* No stop request yet. */ }
      await delay(300);
    }
    console.log('ANGULAR_DEMO_DEBUG_STOPPED');
  } catch (error) {
    await fs.writeFile(path.join(directory, 'error.txt'), String(error));
    throw error;
  } finally {
    if (parent && !ended) await vscode.debug.stopDebugging(parent);
    if (server) await vscode.debug.stopDebugging(server);
    vscode.debug.removeBreakpoints([breakpoint]);
    for (const subscription of subscriptions) subscription.dispose();
  }
}
