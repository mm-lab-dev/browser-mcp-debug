const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const yauzl = require('yauzl');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const filename = `${manifest.name}-${manifest.version}.vsix`;

async function readArchive(file) {
  const zip = await new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true }, (error, zip) => error ? reject(error) : resolve(zip)));
  return new Promise((resolve, reject) => {
    const files = new Map();
    zip.once('error', reject);
    zip.once('end', () => resolve(files));
    zip.on('entry', entry => {
      zip.openReadStream(entry, (error, stream) => {
        if (error) { zip.close(); reject(error); return; }
        const chunks = [];
        stream.once('error', reject);
        stream.on('data', chunk => chunks.push(chunk));
        stream.once('end', () => { files.set(entry.fileName.toLowerCase(), Buffer.concat(chunks)); zip.readEntry(); });
      });
    });
    zip.readEntry();
  });
}

async function main() {
  const file = path.join(root, filename);
  const files = await readArchive(file);
  const allowed = /^(?:\[content_types\]\.xml|extension\.vsixmanifest|extension\/(?:package\.json|readme\.md|changelog\.md|license(?:\.txt)?|support\.md|third_party_notices\.txt|dist\/(?:extension|watchdog)\.js|resources\/icon\.png|resources\/readme\/(?:connections|mcp-access)\.png))$/;
  for (const name of files.keys()) assert.ok(allowed.test(name), `Unexpected file in VSIX: ${name}`);
  const packaged = JSON.parse(files.get('extension/package.json').toString('utf8'));
  assert.equal(packaged.publisher, 'mm-lab');
  assert.equal(packaged.name, 'browser-mcp-debug');
  assert.equal(packaged.version, manifest.version);
  assert.equal(packaged.license, 'MIT');
  assert.equal(packaged.repository.url, 'https://github.com/mm-lab-dev/browser-mcp-debug.git');
  assert.deepEqual(packaged, manifest);
  for (const name of ['LICENSE', 'CHANGELOG.md', 'SUPPORT.md', 'THIRD_PARTY_NOTICES.txt', 'dist/extension.js', 'dist/watchdog.js', 'resources/icon.png', 'resources/readme/connections.png', 'resources/readme/mcp-access.png']) {
    const data = files.get('extension/' + name.toLowerCase()) ?? (name === 'LICENSE' ? files.get('extension/license.txt') : undefined);
    assert.ok(data, `Missing required file: ${name}`);
    assert.deepEqual(data, fs.readFileSync(path.join(root, name)), `Packaged file is stale: ${name}`);
  }
  const readme = files.get('extension/readme.md').toString('utf8');
  for (const image of ['connections', 'mcp-access']) assert.ok(readme.includes(`https://github.com/mm-lab-dev/browser-mcp-debug/raw/main/resources/readme/${image}.png`), 'README image must resolve through the public repository');
  assert.ok(readme.includes('share one dedicated Chrome'));
  assert.ok(!readme.includes('local-dev') && !readme.includes('UNLICENSED'));
  const icon = files.get('extension/resources/icon.png');
  assert.equal(icon.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(icon.readUInt32BE(16), 256);
  assert.equal(icon.readUInt32BE(20), 256);
  const sha256 = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  fs.writeFileSync(file + '.sha256', `${sha256}  ${filename}\n`);
  const output = path.join(root, 'artifacts', 'release');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'package-verification.json'), JSON.stringify({
    checkedAt: new Date().toISOString(), file: filename, sha256, publisher: packaged.publisher,
    version: packaged.version, files: [...files.keys()].sort(),
    checks: ['release metadata', 'distribution file list', 'current bundles and legal files', 'PNG icon', 'HTTPS README image URLs']
  }, null, 2) + '\n');
  console.log(`VERIFIED: ${filename}\nSHA-256: ${sha256}\n${files.size} distribution files; source, samples, profiles, logs and build metadata excluded.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
