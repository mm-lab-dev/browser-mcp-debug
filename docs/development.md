# Development

The extension's user guide is [README.md](../README.md). See [TESTING.md](../TESTING.md) for verification scope and [PUBLISHING.md](../PUBLISHING.md) for release preparation.

## Setup

Use Node.js 22. Keep caches, temporary files, profiles, and verification outputs inside the repository. PowerShell example, from the repository root:

```powershell
New-Item -ItemType Directory -Force .tmp, .cache | Out-Null
$env:TEMP = Join-Path $PWD '.tmp'
$env:TMP = $env:TEMP
$env:TMPDIR = $env:TEMP
$env:npm_config_cache = Join-Path $PWD '.cache\npm'
npm ci --no-audit --no-fund
npm test
npm run test:vscode
npm run package
```

`npm run test:vscode` uses installed desktop VS Code and Chrome with repository-local profiles and an isolated extension directory. Set `BROWSER_MCP_CODE_EXECUTABLE` to override the VS Code executable. The suite uses MCP fixtures and exercises actual Chrome source breakpoints and lifecycle management.

In VS Code, select **Run Browser MCP Extension** in Run and Debug and choose **Start Debugging** to open an extension development window.

The Angular sample uses the actual MCP packages. Its server, Chrome target, breakpoint checks, screenshots, and DevTools memory workflow are described in [the sample README](../samples/angular-demo/README.md).

## Runtime ownership

Both MCP servers run under independent Node watchdog processes connected to the local Extension Host over IPC. Normal stops, failed startup, and Extension Host disconnection stop their owned process trees. Windows cleanup targets the watchdog PID with `taskkill /PID /T /F`; POSIX cleanup targets the owned process group.

For a Chrome launch target (`chrome` or `pwa-chrome`), VS Code starts the dedicated browser first, preserving the target's URL, tasks, web root, and source mapping. The extension chooses a loopback CDP port and connects both MCP servers to the same browser. `browserLaunchLocation: ui` keeps the browser local in Remote-SSH workspaces.

For a Node-only target, the extension starts its own dedicated Chrome before starting MCP and the target. That browser opens at `about:blank` until MCP tools navigate. Use a Chrome target for Angular component debugging.

The profile ownership marker and browser identity prevent adopting a personal Chrome profile or closing a different browser on a reused port. The debugger-owned path verifies Chrome's launch arguments and stores its identity in `browser-mcp-endpoint.json`. Dedicated profiles remain after normal shutdown. A forcibly terminated Extension Host or watchdog can still leave a browser behind; stop that dedicated Chrome before starting a new Chrome target for the same profile.

There are no existing-personal-Chrome connection settings or browser lifecycle switches. Removed settings are rejected with configuration errors. External package commands run only in trusted workspaces.

## Bundles and distribution

`npm run bundle` builds `dist/extension.js` and `dist/watchdog.js`, records build metadata under `.tmp`, and regenerates `THIRD_PARTY_NOTICES.txt` from dependencies actually included in those bundles. Commit the generated notices with runtime dependency changes.

`npm run package` produces a versioned VSIX, runs package verification, and creates a SHA-256 checksum. It does not publish. `.vscodeignore` excludes development tools, sources, samples, profiles, logs, snapshots, and verification outputs. `npm run verify:package` checks an existing package.

## README diagrams and icon

Editable diagrams are in `docs/diagrams/*.mmd`; the README uses rendered PNGs from `resources/readme/` so the extension description does not depend on Mermaid support.

With the cache and temporary-directory settings above:

```powershell
npm install --prefix .tmp/readme-tools --no-save --no-package-lock --ignore-scripts --no-audit --no-fund mermaid@12.3.0
node scripts/render-readme.cjs
npm run icon
```

Rendering uses headless Chrome with repository-local profiles, then closes it. The icon source is `resources/icon.svg`, and its distribution image is `resources/icon.png`.

Release packaging rewrites relative README links and image paths to HTTPS URLs for `mm-lab-dev/browser-mcp-debug` on `main`. Source files and images must be pushed to the public repository before publishing to the Marketplace.
