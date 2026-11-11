# Contributing

Use Node.js 22 and install the exact dependencies with `npm ci`. Follow [the development guide](docs/development.md) to keep caches, temporary files, and browser profiles inside the repository.

Run `npm test` for configuration, orchestration, process cleanup, and MCP transport checks. On a Windows machine with desktop VS Code and Chrome, also run `npm run test:vscode` for real browser debugging and lifecycle checks. See [TESTING.md](TESTING.md) for scope and known gaps.

Describe the behavior changed and the checks performed in your pull request. Update the user-facing README when configuration or connection behavior changes. Connection diagrams have editable sources in `docs/diagrams/`.

Run `npm run package` and `npm run verify:package` when changing packaging or runtime dependencies. The bundle build regenerates `THIRD_PARTY_NOTICES.txt` from the actual bundled packages; include changes to that file with dependency updates.

See [PUBLISHING.md](PUBLISHING.md) for release preparation. Contributions are licensed under the repository's MIT license.
