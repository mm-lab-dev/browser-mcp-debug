import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'fake-devtools', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'list_pages', inputSchema: { type: 'object' } }, { name: 'echo', inputSchema: { type: 'object' } }] }));
server.setRequestHandler(CallToolRequestSchema, async request => ({ content: [{ type: 'text', text: request.params.name === 'list_pages' ? 'dedicated Chrome page' : request.params.name === 'roots' ? JSON.stringify(await server.listRoots()) : JSON.stringify(request.params.arguments) }], isError: process.env.FAKE_CHROME_ERROR === '1' }));
void server.connect(new StdioServerTransport());
