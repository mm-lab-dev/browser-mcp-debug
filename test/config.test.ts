import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConfiguration } from '../src/config';
import { defaults } from './defaults';
test('launch values override settings without modifying defaults', () => {
  const config = parseConfiguration({ target: 'React Dev', playwrightMcp: { port: 9901 } }, defaults);
  assert.equal(config.playwright.port, 9901);
  assert.equal(defaults.playwright.port, 8931);
  assert.deepEqual(config.browser, { executablePath: undefined, userDataDir: undefined });
});
test('rejects unsupported browser behavior and invalid configuration', () => {
  for (const invalid of [
    { target: '' }, { target: 'App', browser: { launch: false } },
    { target: 'App', browser: { launch: true } },
    { target: 'App', browser: { closeOnStop: false } },
    { target: 'App', browser: { closeOnStop: true } },
    { target: 'App', playwrightMcp: { port: 8932 } },
    { target: 'App', playwrightMcp: { enabled: 'yes' } },
    { target: 'App', chromeDevtoolsMcp: { autoConnect: false } },
    { target: 'App', chromeDevtoolsMcp: { autoConnect: true } },
    { target: 'App', chromeDevtoolsMcp: { browserUrl: 'http://127.0.0.1:9222' } },
    { target: 'App', startupTimeout: -1 },
    { target: 'App', playwrightMcp: { cdpEndpoint: 'file:///secret' } }
  ]) assert.throws(() => parseConfiguration(invalid, defaults));
});

test('dedicated Chrome configuration needs no lifecycle switches or external endpoints', () => {
  assert.deepEqual(parseConfiguration({ target: 'App', browser: { type: 'chrome' } }, defaults).browser, parseConfiguration({ target: 'App' }, defaults).browser);
  assert.throws(() => parseConfiguration({ target: 'App', playwrightMcp: { cdpEndpoint: 'http://127.0.0.1:9222' } }, defaults));
  assert.equal(parseConfiguration({ target: 'App', browser: { userDataDir: '/dedicated/profile' } }, defaults).browser.userDataDir, '/dedicated/profile');
});
