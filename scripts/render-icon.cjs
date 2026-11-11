const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

async function main() {
  const root = path.resolve(__dirname, '..');
  const temporary = path.join(root, '.tmp', 'icon-render');
  fs.mkdirSync(temporary, { recursive: true });
  const context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'chrome', headless: true, viewport: { width: 256, height: 256 }, deviceScaleFactor: 1,
    downloadsPath: temporary,
    env: { ...process.env, TEMP: temporary, TMP: temporary, TMPDIR: temporary },
    args: ['--disable-crash-reporter']
  });
  try {
    const page = await context.newPage();
    const svg = fs.readFileSync(path.join(root, 'resources', 'icon.svg'), 'utf8');
    await page.setContent(`<html><body style="margin:0;background:#173d32">${svg}</body></html>`);
    await page.screenshot({ path: path.join(root, 'resources', 'icon.png') });
    console.log('Rendered resources/icon.png (256 × 256).');
  } finally { await context.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
