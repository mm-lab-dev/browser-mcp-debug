import { Settings } from '../src/config';
export const defaults: Settings = {
  playwright: { enabled: true, command: 'npx', package: '@playwright/mcp@latest', port: 8931 },
  devtools: { enabled: true, command: 'npx', package: 'chrome-devtools-mcp@latest', port: 8932 },
  startupTimeout: 120000
};
