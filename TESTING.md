# Verification scope

Browser MCP Debug 0.1.0 was developed and exercised on Windows with desktop VS Code, Chrome, and Node.js 22.23.4. This file describes the checks and the evidence they produce; Marketplace publication has not run.

## Release candidate checked on 2026-11-11

- All 27 unit and process tests passed, including cross-process profile exclusion, cancellation during profile acquisition, and DevTools roots negotiation.
- Real Chrome DevTools MCP saved a screenshot and a heap snapshot under an allowed local root outside the OS temporary directory.
- All six VS Code/Chrome desktop scenarios passed using the `mm-lab.browser-mcp-debug` development extension.
- `npm audit` reported zero vulnerabilities, including development dependencies.
- Package verification passed for all 13 distribution files, including the icon, legal notices, and README image URLs.
- Both workflow files and both issue templates parsed successfully as YAML. The first Linux CI run reported a shutdown/port-release race; the corrected shutdown sequence still needs a Linux CI rerun.

Reviewed package: `browser-mcp-debug-0.1.0.vsix`

SHA-256: `d33dfcabb38813fd317b6d1fdec890a5e2e5ca007846f1587fa2fd1ea217fb62`

## Automated checks

| Command | Scope |
| --- | --- |
| `npm test` | 27 tests for configuration, shared Chrome launch preparation, startup ordering, cancellation, process ownership, watchdog cleanup, HTTP/stdio MCP transport, port release, and browser endpoint identity |
| `npm run test:vscode` | Six desktop scenarios: Node targets with MCP enabled/disabled and parent/child stops; Chrome targets with both stop paths, startup and cleanup tasks, actual source breakpoints, and shared browser cleanup |
| `npm run package` | Build and license generation, VSIX creation, distribution file inspection, release metadata, PNG icon dimensions, README image URL rewriting, asset consistency, and SHA-256 checksum |
| `npm audit` | Installed production and development dependency advisories at execution time |

The unit tests use protocol fixtures instead of real browser MCP packages. The VS Code suite uses real Chrome and the real JavaScript debugger, with repository-local MCP fixtures. Its log is `.tmp/vscode-smoke.log`.

## Real Angular and MCP packages

`npm run demo:angular` uses the actual Playwright MCP and Chrome DevTools MCP packages pinned in the sample configuration. The sample wraps a regular Chrome launch target and verifies:

- The debugger opens the Angular URL before any MCP navigation.
- Both MCP packages connect to that same dedicated Chrome.
- A Playwright task interaction stops at the Angular TypeScript breakpoint in `src/main.ts`, then resumes.
- Task editing, Console messages, and a JSON request are visible through MCP.
- Desktop and mobile layouts render without horizontal overflow.

Evidence is stored in `artifacts/angular-demo/verification.json` and screenshots in the same directory. The breakpoint stack is also recorded in `.tmp/angular-demo/angular-breakpoint.json`.

`npm run demo:angular:memory` captures heap snapshots through **Chrome DevTools MCP**. It does not measure OS process memory. Results are in `artifacts/angular-demo/memory/`. Snapshot growth during a short development-mode run alone does not establish a memory leak.

## Release evidence

The package verifier writes `artifacts/release/package-verification.json` and a checksum beside the versioned VSIX. Generated profiles, logs, snapshots, and verification artifacts are ignored by Git and excluded from the extension package.

## Outstanding validation

- End-to-end operation of the corrected shared-browser flow over Remote-SSH.
- Authentication persistence with Okta or other real identity providers.
- Desktop integration on Linux and macOS.
- A successful GitHub-hosted CI run with the corrected shutdown sequence, public repository image availability, and Marketplace installation after publication.

Before release, run the checks on the release candidate and record real-environment results here. See [PUBLISHING.md](PUBLISHING.md).
