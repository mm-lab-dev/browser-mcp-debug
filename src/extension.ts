import * as vscode from 'vscode';
import { Logger } from './logger';
import { DebugProvider, readConfiguration, targetConfiguration } from './debugProvider';
import { DebugController, SingleRunLease, DapMessage } from './debugController';
import { Runtime } from './runtime';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { ProfileLease } from './profileLease';
import { isChromeLaunch, sharedChromeTarget } from './browserTarget';

const adapters = new Map<string, Adapter>();
const lease = new SingleRunLease();

class Adapter implements vscode.DebugAdapter {
  private readonly emitter = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
  readonly onDidSendMessage = this.emitter.event;
  readonly controller: DebugController;
  readonly children = new Map<string, vscode.DebugSession>();
  constructor(readonly session: vscode.DebugSession, log: Logger, profileDirectory: string) {
    const config = readConfiguration(session.workspaceFolder, session.configuration);
    profileDirectory = config.browser.userDataDir ?? profileDirectory;
    const profileLease = new ProfileLease(profileDirectory, error => {
      log.error(error.message); void this.controller.stop();
    });
    const fileRoots = (vscode.workspace.workspaceFolders ?? []).filter(folder => folder.uri.scheme === 'file').map(folder => folder.uri.fsPath);
    const targetOwnsBrowser = isChromeLaunch(targetConfiguration(session.workspaceFolder, config.target));
    let debuggerPort: number | undefined;
    this.controller = new DebugController(
      message => this.emitter.fire(message as vscode.DebugProtocolMessage),
      {
        prepare: () => profileLease.acquire(),
        release: () => profileLease.release(),
        targetOwnsBrowser,
        startTarget: async () => {
          // Resolve by name so the target's variables, tasks and adapter remain
          // under VS Code's control on the appropriate remote Extension Host.
          const target = targetConfiguration(session.workspaceFolder, config.target);
          const launch = targetOwnsBrowser ? await sharedChromeTarget(target, config.browser, profileDirectory) : config.target;
          if (typeof launch !== 'string') debuggerPort = launch.port;
          if (targetOwnsBrowser) log.info(`Sharing the Chrome debugger's browser with both MCP servers: ${config.target}`);
          return vscode.debug.startDebugging(session.workspaceFolder, launch, { parentSession: session, lifecycleManagedByParent: false, noDebug: session.configuration.noDebug });
        },
        stopTargets: async () => { await Promise.all([...this.children.values()].map(child => vscode.debug.stopDebugging(child))); },
        report: error => { log.error(error.message); void vscode.window.showErrorMessage(`Browser MCP: ${error.message}`); }
      }, lease, (options, failure) => new Runtime(options, log, failure, profileDirectory, targetOwnsBrowser ? () => debuggerPort : undefined, fileRoots), config, log
    );
  }
  handleMessage(message: vscode.DebugProtocolMessage): void { this.controller.handle(message as DapMessage); }
  dispose(): void {
    void this.controller.stop().finally(async () => {
      // A late target can appear after an interrupted preLaunchTask. Preserve
      // its parent association until startDebugging has actually settled.
      await this.controller.waitForLaunch();
      adapters.delete(this.session.id);
      this.emitter.dispose();
    });
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Browser MCP');
  const log = new Logger(output, vscode.workspace.getConfiguration('browserMcp').get('logging.level', 'info'));
  log.info(`Host platform: ${process.platform}; remote: ${vscode.env.remoteName ?? 'local'}`);
  context.subscriptions.push(output,
    vscode.commands.registerCommand('browserMcp.showOutput', () => output.show()),
    vscode.debug.registerDebugConfigurationProvider('browser-mcp', new DebugProvider()),
    vscode.debug.registerDebugAdapterDescriptorFactory('browser-mcp', {
      createDebugAdapterDescriptor(session) {
        const workspaceKey = createHash('sha256').update(session.workspaceFolder?.uri.toString() ?? '').digest('hex').slice(0, 24);
        const adapter = new Adapter(session, log, path.join(context.globalStorageUri.fsPath, 'chrome-profiles', workspaceKey));
        adapters.set(session.id, adapter);
        return new vscode.DebugAdapterInlineImplementation(adapter);
      }
    }),
    vscode.debug.onDidStartDebugSession(session => {
      if (!session.parentSession) return;
      const adapter = adapters.get(session.parentSession.id);
      if (!adapter) return;
      adapter.children.set(session.id, session);
      if (adapter.controller.isStopped) void vscode.debug.stopDebugging(session);
    }),
    vscode.debug.onDidTerminateDebugSession(session => {
      if (session.type === 'browser-mcp') { void adapters.get(session.id)?.controller.stop(); return; }
      if (!session.parentSession) return;
      const adapter = adapters.get(session.parentSession.id);
      if (adapter?.children.delete(session.id)) adapter.controller.targetEnded();
    })
  );
}

export async function deactivate(): Promise<void> {
  await Promise.all([...adapters.values()].map(adapter => adapter.controller.stop()));
  adapters.clear();
}
