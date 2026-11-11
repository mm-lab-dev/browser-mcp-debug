import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { ManagedProcess } from './processManager';
import { setTimeout as delay } from 'node:timers/promises';
import net from 'node:net';

export const clientInfo = { name: 'browser-mcp-debug', version: '0.1.1' };

export async function assertPortAvailable(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`Host MCP port ${port} is already in use. Choose another port; existing processes will not be stopped.`)));
    server.listen(port, '127.0.0.1', () => server.close(error => error ? reject(error) : resolve()));
  });
}

export class ProcessTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private readonly buffer = new ReadBuffer();
  constructor(private readonly process: ManagedProcess, private readonly command: string, private readonly args: string[]) {}
  async start(): Promise<void> {
    this.process.on('stdout', (data: string) => {
      this.buffer.append(Buffer.from(data));
      try {
        for (;;) {
          const message = this.buffer.readMessage();
          if (!message) break;
          this.onmessage?.(message);
        }
      } catch (error) { this.onerror?.(error as Error); }
    });
    this.process.on('failure', (error: Error) => { this.onerror?.(error); this.onclose?.(); });
    await this.process.start(this.command, this.args);
  }
  send(message: JSONRPCMessage): Promise<void> { return this.process.write(serializeMessage(message)); }
  async close(): Promise<void> { await this.process.stop(); this.onclose?.(); }
}

export async function waitForHttpMcp(url: string, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    const client = new Client(clientInfo);
    const transport = new StreamableHTTPClientTransport(new URL(url));
    try {
      // Protocol initialize (not merely an open TCP port) proves readiness.
      await client.connect(transport, { signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]) });
      return;
    } catch { if (!signal.aborted) await delay(150, undefined, { signal }); }
    finally { await client.close().catch(() => {}); }
  }
  signal.throwIfAborted();
}
