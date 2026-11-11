const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const temporary = path.join(root, '.tmp');
fs.mkdirSync(temporary, { recursive: true });
const code = process.env.BROWSER_MCP_CODE_EXECUTABLE || (process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe') : 'code');
const env = { ...process.env, TEMP: temporary, TMP: temporary, TMPDIR: temporary, NODE_DISABLE_COMPILE_CACHE: '1' };
// A repository-local npx-compatible fixture exercises the packaged process
// launcher without installing MCPs or accessing the user's authenticated Chrome.
const fakeBin = path.join(temporary, 'fake-bin');
const fakeCli = path.join(fakeBin, 'node_modules', 'npm', 'bin', 'npx-cli.js');
fs.mkdirSync(path.dirname(fakeCli), { recursive: true });
fs.writeFileSync(fakeCli, `
const args = process.argv.slice(2);
if (args[1] === 'fixture-playwright') {
  process.argv[2] = args[args.indexOf('--port') + 1];
  require(${JSON.stringify(path.join(root, 'out', 'test', 'fixtureHttpMcp.js'))});
} else {
  require(${JSON.stringify(path.join(root, 'out', 'test', 'fixtureMcp.js'))});
}
`);
const fakeCommand = path.join(fakeBin, process.platform === 'win32' ? 'npx.cmd' : 'npx');
fs.writeFileSync(fakeCommand, process.platform === 'win32' ? '@echo off\r\n' : `#!/bin/sh\nexec node '${fakeCli.replaceAll("'", "'\\''")}' "$@"\n`, { mode: 0o755 });
env.BROWSER_MCP_SMOKE_NPX = fakeCommand;
delete env.ELECTRON_RUN_AS_NODE;
delete env.VSCODE_IPC_HOOK_CLI;
const args = [
  '--extensionDevelopmentPath=' + root,
  '--extensionTestsPath=' + path.join(root, 'out', 'test', 'vscodeSmoke.js'),
  '--user-data-dir=' + path.join(temporary, 'vscode-user'),
  '--extensions-dir=' + path.join(temporary, 'vscode-extensions'),
  '--crash-reporter-directory=' + path.join(temporary, 'crashes'),
  '--disable-crash-reporter', '--disable-telemetry', '--disable-updates',
  '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
  path.join(root, 'test', 'fixtures', 'workspace')
];
const log = fs.createWriteStream(path.join(temporary, 'vscode-smoke.log'));
const child = spawn(code, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let passed = false;
child.stdout.on('data', data => { log.write(data); if (data.toString().includes('BROWSER_MCP_VSCODE_SMOKE_OK')) { passed = true; console.log('BROWSER_MCP_VSCODE_SMOKE_OK'); } });
child.stderr.on('data', data => log.write(data));
const timeout = setTimeout(() => {
  console.error('VS Code smoke test timed out.');
  if (process.platform === 'win32') spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else child.kill();
}, 60000);
child.on('error', error => { clearTimeout(timeout); console.error(error.message); log.end(); process.exitCode = 1; });
child.on('exit', code => { clearTimeout(timeout); log.end(); process.exitCode = code === 0 && passed ? 0 : 1; if (process.exitCode) console.error('See .tmp/vscode-smoke.log for details.'); });
