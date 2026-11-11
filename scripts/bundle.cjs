const esbuild = require('esbuild');
const path = require('node:path');
const fs = require('node:fs');
const { writeNotices } = require('./third-party-notices.cjs');
Promise.all(['extension', 'watchdog'].map(name => esbuild.build({
  entryPoints: [path.join('src', name + '.ts')],
  outfile: path.join('dist', name + '.js'),
  bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  external: ['vscode'], sourcemap: true, metafile: true
}))).then(results => {
  fs.mkdirSync('.tmp', { recursive: true });
  fs.writeFileSync(path.join('.tmp', 'bundle-metadata.json'), JSON.stringify(results.map(result => result.metafile), null, 2));
  writeNotices(results.map(result => result.metafile));
}).catch(error => { console.error(error); process.exitCode = 1; });
