import * as vscode from 'vscode';
import { parseConfiguration, Configuration, Settings } from './config';

export function readConfiguration(folder: vscode.WorkspaceFolder | undefined, raw: vscode.DebugConfiguration): Configuration {
  const settings = vscode.workspace.getConfiguration('browserMcp', folder?.uri);
  const defaults: Settings = {
    playwright: { enabled: true, command: settings.get('playwright.command', 'npx'), package: settings.get('playwright.package', '@playwright/mcp@latest'), port: settings.get('playwright.defaultPort', 8931) },
    devtools: { enabled: true, command: settings.get('devtools.command', 'npx'), package: settings.get('devtools.package', 'chrome-devtools-mcp@latest'), port: settings.get('devtools.defaultPort', 8932) },
    startupTimeout: settings.get('startupTimeout', 120000)
  };
  return parseConfiguration(raw, defaults);
}

export function targetConfiguration(folder: vscode.WorkspaceFolder | undefined, name: string): vscode.DebugConfiguration {
  const targets = vscode.workspace.getConfiguration('launch', folder?.uri).get<vscode.DebugConfiguration[]>('configurations', []);
  const matching = targets.filter(target => target.name === name);
  if (matching.length !== 1) throw new Error(`Target "${name}" must name exactly one debug configuration in the same workspace folder. Compounds are not supported in MVP.`);
  if (matching[0].type === 'browser-mcp') throw new Error('A browser-mcp target cannot reference another browser-mcp configuration.');
  return matching[0];
}

export class DebugProvider implements vscode.DebugConfigurationProvider {
  async resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): Promise<vscode.DebugConfiguration | undefined> {
    try {
      if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before starting host-side commands.');
      if (!folder) throw new Error('Open the frontend workspace folder before starting Browser MCP. For Remote-SSH, connect and open the remote folder first.');
      if (config.request !== 'launch') throw new Error('Browser MCP supports request="launch" only.');
      const parsed = readConfiguration(folder, config);
      targetConfiguration(folder, parsed.target);
      return config;
    } catch (error) {
      await vscode.window.showErrorMessage(`Browser MCP: ${String(error)}`);
      return undefined;
    }
  }
}
