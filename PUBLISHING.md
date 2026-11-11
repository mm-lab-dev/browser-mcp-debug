# Publishing Browser MCP Debug

Prepared release: **0.1.0**

Repository: **https://github.com/mm-lab-dev/browser-mcp-debug**

Marketplace publisher: **mm-lab**

Extension ID: **mm-lab.browser-mcp-debug**

`npm run package` only creates and verifies a local VSIX. No script or GitHub workflow in this repository publishes the extension automatically.

## Prepare the source repository

1. Create or confirm `mm-lab-dev/browser-mcp-debug` with `main` as its default branch.
2. Review and commit the prepared source, MIT license, changelog, support information, icon, and third-party notices.
3. Push the source and the matching release tag, such as `v0.1.0`, when ready to release.
4. Make the repository public before Marketplace publication. The packaged README uses HTTPS image URLs under `main`; those images must be publicly accessible.

Repository creation, commits, pushes, tags, GitHub releases, and Marketplace publication are separate release actions. They have not been performed by the preparation scripts.

## Validate and package

Use Node.js 22. See [the development guide](docs/development.md) for repository-local cache and temporary-directory settings.

```sh
npm ci
npm test
npm audit
npm run test:vscode
npm run package
```

`test:vscode` requires a Windows desktop with Chrome and VS Code. Set `BROWSER_MCP_CODE_EXECUTABLE` if VS Code is not in the default location.

Packaging produces:

- `browser-mcp-debug-0.1.0.vsix`
- `browser-mcp-debug-0.1.0.vsix.sha256`
- `artifacts/release/package-verification.json`

The package command builds both runtime bundles, generates notices for the dependencies actually included, creates the VSIX, and inspects its contents. Verification rejects unexpected files, stale bundles or assets, missing legal files, invalid release metadata, and README images without repository HTTPS URLs. Run `npm run verify:package` to inspect an existing package again.

The packaging tool's `minimatch` dependency is pinned through a scoped override to a patched release. Keep the override until the packaging tool's declared range includes the fix; run the audit and package verification after changing it.

## Review the installation

1. Confirm access to the existing `mm-lab` Marketplace publisher. The GitHub organization and Marketplace publisher are different identifiers.
2. Remove any internal `local-dev.browser-mcp-debug` test installation to avoid duplicate debugger registrations. The release extension uses `mm-lab.browser-mcp-debug`.
3. Install the reviewed VSIX **locally** in desktop VS Code, including when using Remote-SSH, and reload the window.
4. Wrap a regular Chrome launch target. Verify that only one dedicated Chrome opens at the target URL, browser breakpoints still work, and both MCP clients see that same page.
5. Verify startup and cleanup tasks, parent and target stopping, MCP port release, and retained profile data.
6. Verify a real Remote-SSH workspace, development-server forwarding, and reverse tunnels for a remote MCP client. This remains a release validation gap; do not describe it as verified until recorded in [TESTING.md](TESTING.md).
7. Review the Marketplace preview, icon, README images, links, and changelog.

## GitHub Actions

- **CI** runs unit and process tests on Windows and Linux, builds the bundle, audits installed dependencies, checks reproducible notices, and verifies the VSIX.
- **Prepare release package** is started manually from the Actions tab. It builds a versioned VSIX and checksum and uploads them as workflow artifacts. It does not create a GitHub release or publish to the Marketplace.

The workflows do not run the desktop VS Code/Chrome integration suite. Run that locally and record the result before publishing. Workflow artifacts are temporary review downloads; attach the reviewed VSIX and checksum to a GitHub release for durable distribution.

## Publish the reviewed package

After the source, listing, installation, and real-environment checks are complete, upload the exact reviewed VSIX through [Marketplace publisher management](https://marketplace.visualstudio.com/manage/publishers/), or authenticate the publisher and run:

```sh
npx vsce publish --packagePath browser-mcp-debug-0.1.0.vsix
```

Use the [current VS Code publishing guidance](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) for authentication. If automated Marketplace publishing is added later, use Trusted Publishing rather than committing a long-lived token.

For later releases, update `package.json`, `package-lock.json`, `src/mcp.ts`, and `CHANGELOG.md` together. Update the version examples in this document, rerun validation, and publish the package for that version.
