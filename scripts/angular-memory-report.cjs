function renderMemoryReport(evidence) {
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const rows = evidence.snapshots.map(snapshot => `<tr><td><a href="${escape(snapshot.file)}">${escape(snapshot.name)}</a></td><td>${snapshot.toggles} / ${snapshot.requests}</td><td>${(snapshot.totalSelfSizeBytes / 1048576).toFixed(2)}</td><td>${(snapshot.deltaBytes / 1024).toFixed(1)}</td><td>${snapshot.nodeCount}</td><td>${snapshot.after.domElements}</td><td>${snapshot.detachedNativeNodes}</td></tr>`).join('');
  const growth = evidence.snapshots.at(-1).growth.map(item => `<tr><td>${escape(item.name)}</td><td>${item.countDelta}</td><td>${(item.selfSizeDelta / 1024).toFixed(1)}</td></tr>`).join('');
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Angular — DevTools memory report</title>
<style>
body{font:14px/1.8 system-ui,sans-serif;max-width:1100px;margin:40px auto;padding:0 24px;color:#213b32;background:#f6f8f6}
h1{font-size:25px}table{border-collapse:collapse;background:white;width:100%;margin:24px 0}
th,td{padding:12px;border-bottom:1px solid #dce4de;text-align:right}th:first-child,td:first-child{text-align:left}
th{background:#e4eee6}a{color:#25634b}code{background:#e6ece6;padding:3px 6px}li{margin-bottom:8px}
.table-scroll{overflow-x:auto}
</style>
<h1>Angular page memory report</h1>
<p>Measured with Chrome DevTools MCP <code>take_heapsnapshot</code> and <code>evaluate_script</code>. These are page heap measurements, not OS process memory totals.</p>
<p>${escape(evidence.measuredAt)} / ${escape(evidence.url)}</p>
<div class="table-scroll"><table><thead><tr><th>Checkpoint</th><th>Cumulative toggles / API calls</th><th>Post-GC heap MiB</th><th>Change from baseline KiB</th><th>Heap nodes</th><th>Connected DOM elements</th><th>Detached native nodes</th></tr></thead><tbody>${rows}</tbody></table></div>
<ul>
<li>Heap size is the sum of all snapshot nodes' <code>self_size</code> values, including JavaScript objects, code, strings, and native nodes. It is neither total Chrome RAM usage nor the size of a .heapsnapshot file.</li>
<li>A warm-up snapshot is taken before the baseline. Taking a heap snapshot triggers garbage collection.</li>
<li>The task count stays unchanged while 600 toggles and 30 API calls run in two measured stages. The final snapshot follows a 10-second wait and clearing the Console.</li>
<li>DOM element count is <code>document.querySelectorAll('*').length</code>. Detached native nodes have <code>type=native</code> and <code>detachedness=2</code> in the snapshot; this count does not establish a leak.</li>
<li>Angular/Vite development mode, MCP profiling, JIT compilation, and Console or Network history affect these measurements. This short run cannot establish whether a memory leak exists.</li>
<li>Load the linked .heapsnapshot files in Chrome DevTools' Memory panel and use Comparison view to inspect changes and retaining paths.</li>
</ul>
<h2>Largest increases in the final snapshot (self_size)</h2>
<div class="table-scroll"><table><thead><tr><th>Type / name</th><th>Count change</th><th>Increase KiB</th></tr></thead><tbody>${growth}</tbody></table></div>
<p><a href="results.json">Raw data and MCP call records</a> / <a href="https://developer.chrome.com/docs/devtools/memory-problems/heap-snapshots">Chrome DevTools: Heap snapshots</a></p>
</html>`;
}
module.exports = { renderMemoryReport };
