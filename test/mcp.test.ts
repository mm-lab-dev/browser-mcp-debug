import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { DevtoolsGateway } from '../src/chromeDevtoolsMcp';
import { ManagedProcess } from '../src/processManager';
import { assertPortAvailable, clientInfo, waitForHttpMcp } from '../src/mcp';

const log = { info() {}, error() {}, debug() {} };
async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}
class FixtureProcess extends ManagedProcess {
  override start(): Promise<void> { return super.start(process.execPath, [path.join(__dirname, 'fixtureMcp.js')]); }
}
test('DevTools stdio handshake, Chrome probe and real HTTP tools round trip', { timeout: 15000 }, async () => {
  const port = await freePort();
  const process = new FixtureProcess('fixture', log);
  const gateway = new DevtoolsGateway();
  const client = new Client(clientInfo);
  try {
    const fileRoots = [path.resolve('.tmp/devtools-output'), path.resolve('test/fixtures/workspace')];
    await gateway.start(process, { enabled: true, command: 'unused', package: 'unused', port }, 'http://127.0.0.1:19222', AbortSignal.timeout(10000), log, fileRoots);
    await waitForHttpMcp(`http://127.0.0.1:${port}/mcp`, AbortSignal.timeout(3000));
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    assert.ok((await client.listTools()).tools.some(tool => tool.name === 'echo'));
    const result = await client.callTool({ name: 'echo', arguments: { message: '日本語 round trip' } });
    assert.match(JSON.stringify(result), /日本語 round trip/);
    // The upstream stdio server receives local roots independently of the HTTP client.
    const roots = await client.callTool({ name: 'roots', arguments: {} });
    assert.deepEqual(JSON.parse((roots.content as { text: string }[])[0].text), { roots: fileRoots.map(directory => ({ uri: pathToFileURL(directory).href })) });
    const badOrigin = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { Origin: 'https://example.com' } });
    assert.equal(badOrigin.status, 403);
    const badHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/mcp`, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
    });
    assert.equal(badHostStatus, 403);
  } finally { await client.close(); await gateway.stop(); await process.stop(); }
  await assertPortAvailable(port);
});
test('occupied port is refused without touching its owner', async () => {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await assert.rejects(assertPortAvailable((server.address() as net.AddressInfo).port), /already in use/); assert.equal(server.listening, true); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
test('readiness against non-MCP or absent HTTP service obeys cancellation', async () => {
  const port = await freePort();
  await assert.rejects(waitForHttpMcp(`http://127.0.0.1:${port}/mcp`, AbortSignal.timeout(200)));
});
