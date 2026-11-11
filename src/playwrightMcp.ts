import { Configuration } from './config';
import { ManagedProcess } from './processManager';
import { waitForHttpMcp } from './mcp';
import { Log } from './logger';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { clientInfo } from './mcp';

export async function startPlaywright(process: ManagedProcess, config: Configuration['playwright'], endpoint: string, signal: AbortSignal, log: Log): Promise<void> {
  const args = ['-y', config.package, '--host', '127.0.0.1', '--port', String(config.port), '--cdp-endpoint', endpoint];
  process.on('stdout', (data: string) => log.info(`[Playwright] ${data.trimEnd()}`));
  await process.start(config.command, args);
  await waitForHttpMcp(`http://127.0.0.1:${config.port}/mcp`, signal);
  const client = new Client(clientInfo);
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${config.port}/mcp`)), { signal });
    const tabs = await client.callTool({ name: 'browser_tabs', arguments: { action: 'list' } }, undefined, { signal });
    if (tabs.isError) throw new Error(`Playwright MCP cannot connect to dedicated Chrome: ${JSON.stringify(tabs.content)}`);
  } finally { await client.close(); }
  log.info(`Playwright MCP ready: http://127.0.0.1:${config.port}/mcp`);
}
