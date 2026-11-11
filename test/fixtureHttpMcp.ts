import http from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

http.createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
  const server = new Server({ name: 'fake-playwright', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'browser_tabs', inputSchema: { type: 'object' } }] }));
  server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'existing tabs' }] }));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  response.on('close', () => { void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(request, response, body);
}).listen(Number(process.argv[2]), '127.0.0.1');
