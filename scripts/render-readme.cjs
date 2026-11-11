// Documentation images, rendered using the repository-local Mermaid toolchain.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');
async function main() {
  const script = path.join(root, '.tmp', 'readme-tools', 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
  if (!fs.existsSync(script)) throw new Error('Install Mermaid in .tmp/readme-tools as described in docs/development.md.');
  fs.mkdirSync(path.join(root, 'resources', 'readme'), { recursive: true });
  const temporary = path.join(root, '.tmp', 'readme-render');
  fs.mkdirSync(temporary, { recursive: true });
  const context = await chromium.launchPersistentContext(path.join(temporary, 'chrome-profile'), {
    channel: 'chrome', headless: true,
    viewport: { width: 1800, height: 1200 }, deviceScaleFactor: 2,
    downloadsPath: temporary,
    env: { ...process.env, TEMP: temporary, TMP: temporary, TMPDIR: temporary },
    args: ['--disable-crash-reporter']
  });
  try {
    const page = await context.newPage();
    await page.setContent('<!doctype html><html lang="en"><meta charset="utf-8"><body style="margin:0;padding:24px;background:white"><div id="diagram" style="display:inline-block"></div></body></html>');
    await page.addScriptTag({ path: script });
    for (const name of ['connections', 'mcp-access']) {
      const source = fs.readFileSync(path.join(root, 'docs', 'diagrams', name + '.mmd'), 'utf8');
      await page.evaluate(async ({ name, source }) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: {
          fontFamily: 'Segoe UI, Yu Gothic UI, Meiryo, sans-serif', fontSize: '17px',
          primaryColor: '#e9f4ee', primaryTextColor: '#183d2e', primaryBorderColor: '#76a68b',
          lineColor: '#557365', clusterBkg: '#f6f9f7', clusterBorder: '#c4d6ca', edgeLabelBackground: '#ffffff'
        }, flowchart: { useMaxWidth: false, htmlLabels: true, nodeSpacing: 30, rankSpacing: 40, padding: 12, wrappingWidth: 320 } });
        const { svg } = await mermaid.render('diagram-' + name, source);
        document.getElementById('diagram').innerHTML = svg;
        await document.fonts.ready;
      }, { name, source });
      await page.locator('#diagram').screenshot({ path: path.join(root, 'resources', 'readme', name + '.png') });
      console.log(`Rendered ${name}`);
    }
  } finally { await context.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
