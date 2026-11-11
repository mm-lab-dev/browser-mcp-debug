import http from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';
import { ManagedProcess } from './processManager';
import { Configuration } from './config';
import { ProcessTransport, clientInfo } from './mcp';
import { Log } from './logger';

/** DevTools provides tools over stdio; expose those tools over stateless HTTP. */
export class DevtoolsGateway {
  private client?: Client;
  private server?: http.Server;
  private closing = false;
  private readonly connections = new Set<Server>();
  async start(process: ManagedProcess, config: Configuration['devtools'], endpoint: string, signal: AbortSignal, log: Log, fileRoots: string[] = []): Promise<void> {
    const args = ['-y', config.package, `--browser-url=${endpoint}`];
    const client = this.client = new Client(clientInfo, { capabilities: { roots: {} } });
    client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: fileRoots.map(directory => ({ uri: pathToFileURL(directory).href })) }));
    await client.connect(new ProcessTransport(process, config.command, args), { signal });
    const tools = await client.listTools(undefined, { signal });
    if (!tools.tools.some(tool => tool.name === 'list_pages')) throw new Error('Chrome DevTools MCP does not provide list_pages. Check the configured package.');
    // DevTools connects lazily. An initialize handshake alone misses Chrome failures.
    const pages = await client.callTool({ name: 'list_pages', arguments: {} }, undefined, { signal });
    if (pages.isError) throw new Error(`Chrome DevTools MCP cannot connect to Chrome: ${JSON.stringify(pages.content)}`);
    signal.throwIfAborted();
    if (this.closing) throw new Error('Startup cancelled.');
    const server = this.server = http.createServer((request, response) => { void this.handle(request, response, config.port, client, log); });
    server.requestTimeout = 30000;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, '127.0.0.1', resolve);
    });
    log.info(`Chrome DevTools MCP ready: http://127.0.0.1:${config.port}/mcp (tools gateway)`);
  }
  private async handle(request: http.IncomingMessage, response: http.ServerResponse, port: number, client: Client, log: Log): Promise<void> {
    const host = request.headers.host;
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host ?? '') || request.headers.origin) {
      response.writeHead(403).end(); return;
    }
    if (request.url !== '/mcp') { response.writeHead(404).end(); return; }
    if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST' }).end(); return; }
    if (!request.headers['content-type']?.includes('application/json')) { response.writeHead(415).end(); return; }
    let size = 0;
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 1024 * 1024) { response.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { response.writeHead(400).end(); return; }
      if (this.closing) { response.writeHead(503).end(); return; }
      const proxy = new Server(clientInfo, { capabilities: { tools: {} } });
      proxy.setRequestHandler(ListToolsRequestSchema, (params, extra) => client.listTools(params.params, { signal: extra.signal }));
      proxy.setRequestHandler(CallToolRequestSchema, (params, extra) => client.callTool(params.params, undefined, { signal: extra.signal }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      this.connections.add(proxy);
      response.on('close', () => { this.connections.delete(proxy); void proxy.close().catch(() => {}); });
      await proxy.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch (error) {
      log.error(`DevTools HTTP gateway: ${String(error)}`);
      if (!response.headersSent) response.writeHead(500).end();
      else response.end();
    }
  }
  async stop(): Promise<void> {
    this.closing = true;
    await Promise.allSettled([...this.connections].map(connection => connection.close()));
    if (this.server) {
      const server = this.server;
      await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    }
    await this.client?.close();
  }
}
