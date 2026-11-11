// Measure the Angular page through Chrome DevTools MCP, not OS process memory.
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { renderMemoryReport } = require('./angular-memory-report.cjs');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const root = path.resolve(__dirname, '..');
const temporary = path.join(root, '.tmp', 'angular-demo', 'memory');
const output = path.join(root, 'artifacts', 'angular-demo', 'memory');
const evidence = { measuredAt: new Date().toISOString(), transport: 'Chrome DevTools MCP HTTP tools gateway :8932', calls: [], snapshots: [] };
const client = new Client({ name: 'angular-devtools-memory', version: '1.0.0' });
let pageId;

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  evidence.calls.push({ time: new Date().toISOString(), tool: name, arguments: args, result });
  if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.content)}`);
  return result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
}
async function evaluate(source) {
  const text = await call('evaluate_script', { pageId, function: source, waitForStableDom: false });
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match) throw new Error('DevTools evaluate_script did not return JSON.');
  return JSON.parse(match[1]);
}
async function metrics() {
  return evaluate(`() => ({
    url: location.href,
    domElements: document.querySelectorAll('*').length,
    tasks: Number(document.querySelector('[data-testid="total-count"]').textContent),
    completed: Number(document.querySelector('[data-testid="done-count"]').textContent),
    approximateUsedJSHeapBytes: performance.memory?.usedJSHeapSize ?? null,
    approximateTotalJSHeapBytes: performance.memory?.totalJSHeapSize ?? null
  })`);
}
function summarize(filename) {
  const snapshot = JSON.parse(fs.readFileSync(filename, 'utf8'));
  const fields = snapshot.snapshot.meta.node_fields;
  const width = fields.length;
  const index = name => fields.indexOf(name);
  const typeNames = snapshot.snapshot.meta.node_types[index('type')];
  const summary = { totalSelfSizeBytes: 0, nodeCount: snapshot.snapshot.node_count, detachedNativeNodes: 0, detachednessFieldAvailable: index('detachedness') >= 0, types: {}, classes: {} };
  for (let offset = 0; offset < snapshot.nodes.length; offset += width) {
    const type = typeNames[snapshot.nodes[offset + index('type')]];
    const name = snapshot.strings[snapshot.nodes[offset + index('name')]];
    const size = snapshot.nodes[offset + index('self_size')];
    summary.totalSelfSizeBytes += size;
    const aggregate = summary.types[type] ??= { count: 0, selfSizeBytes: 0 };
    aggregate.count++; aggregate.selfSizeBytes += size;
    if (type === 'native' && index('detachedness') >= 0 && snapshot.nodes[offset + index('detachedness')] === 2) summary.detachedNativeNodes++;
    const key = `${type}: ${name}`;
    const group = summary.classes[key] ??= { count: 0, selfSizeBytes: 0 };
    group.count++; group.selfSizeBytes += size;
  }
  return summary;
}
async function capture(name, toggles, requests, measured = true) {
  const before = await metrics();
  const filename = path.join(temporary, `${name}.heapsnapshot`);
  await call('take_heapsnapshot', { pageId, filePath: filename });
  const summary = summarize(filename);
  const after = await metrics();
  const destination = path.join(output, path.basename(filename));
  fs.copyFileSync(filename, destination);
  const result = { name, toggles, requests, file: path.basename(destination), before, after, ...summary };
  if (measured) evidence.snapshots.push(result);
  console.log(`${name}: ${(summary.totalSelfSizeBytes / 1048576).toFixed(2)} MiB; ${summary.nodeCount} heap nodes; ${after.domElements} DOM elements; ${summary.detachedNativeNodes} detached native nodes`);
  return result;
}
async function workload() {
  // Keep task count unchanged. Use the actual app event handlers through DOM clicks.
  return evaluate(`async () => {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const checkbox = document.querySelector('[role="checkbox"][aria-label="Mark a task complete and watch it update"]');
    const request = document.querySelector('button[aria-label="Send an API request"]');
    for (let i = 0; i < 100; i++) { checkbox.click(); await pause(15); }
    for (let i = 0; i < 5; i++) {
      request.click(); await pause(20);
      while (request.disabled) await pause(10);
      if (!document.querySelector('[data-testid="last-event"]').textContent.includes('200')) throw new Error('Demo API request failed.');
    }
    return { toggles: 100, requests: 5, tasks: Number(document.querySelector('[data-testid="total-count"]').textContent) };
  }`);
}
function writeReport() {
  const baseline = evidence.snapshots[0];
  for (const snapshot of evidence.snapshots) {
    snapshot.deltaBytes = snapshot.totalSelfSizeBytes - baseline.totalSelfSizeBytes;
    snapshot.growth = Object.entries(snapshot.classes).map(([name, group]) => ({
      name, countDelta: group.count - (baseline.classes[name]?.count ?? 0),
      selfSizeDelta: group.selfSizeBytes - (baseline.classes[name]?.selfSizeBytes ?? 0)
    })).filter(item => item.selfSizeDelta > 0).sort((a, b) => b.selfSizeDelta - a.selfSizeDelta).slice(0, 15);
  }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(evidence, null, 2));
  fs.writeFileSync(path.join(output, 'report.html'), renderMemoryReport(evidence));
}
async function main() {
  fs.mkdirSync(temporary, { recursive: true });
  fs.mkdirSync(output, { recursive: true });
  await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:8932/mcp')));
  try {
    const pages = await call('list_pages', {});
    pageId = Number(pages.match(/^(\d+):.*127\.0\.0\.1:4201/m)?.[1]);
    if (!Number.isFinite(pageId)) throw new Error('Start npm run demo:angular first.');
    evidence.url = (await metrics()).url;
    await capture('00-warmup', 0, 0, false);
    await capture('01-baseline', 0, 0);
    for (let batch = 1; batch <= 6; batch++) {
      const result = await workload();
      if (result.toggles !== 100 || result.requests !== 5) throw new Error('Workload incomplete.');
      console.log(`DevTools workload ${batch}/6 complete`);
      if (batch % 3 === 0) await capture(`0${batch / 3 + 1}-after-${batch * 100}-toggles`, batch * 100, batch * 5);
    }
    await delay(10000);
    await evaluate('() => { console.clear(); return { consoleCleared: true }; }');
    await capture('04-idle-console-cleared', 600, 30);
    writeReport();
    console.log(`REPORT: ${path.join(output, 'report.html')}`);
  } finally { await client.close(); }
}
main().catch(error => { fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'partial-results.json'), JSON.stringify(evidence, null, 2)); console.error(error); process.exitCode = 1; });
