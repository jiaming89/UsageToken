# usagetoken

A Node/TypeScript CLI for collecting local coding-agent token usage. The runtime
implementation is independent from `ccusage`, but JSON output is kept compatible
with `ccusage 20.0.19` for the fields used by team reporting.

## Usage

Build first, then run the compiled CLI:

```bash
npm run build
node dist/bin/usagetoken.js daily --json --offline
node dist/bin/usagetoken.js weekly --timezone Asia/Shanghai
node dist/bin/usagetoken.js monthly --upload-file ./out/monthly.json
node dist/bin/usagetoken.js session --since 2026-07-01 --until 2026-07-31
node dist/bin/usagetoken.js blocks --json --offline
```

Supported commands:

- `daily`
- `weekly`
- `monthly`
- `session`
- `blocks`

Important options:

- `--json`
- `--since YYYY-MM-DD`
- `--until YYYY-MM-DD`
- `--timezone <IANA timezone>`
- `--mode auto|display|calculate`
- `--offline`
- `--no-cost`
- `--upload-file <path>`
- `--source <name>`
- `--by-source`

`--upload-file` writes a local envelope whose `payload` is the same
ccusage-compatible JSON produced by the command.

By default, `daily`, `weekly`, and `monthly` merge all sources into ccusage's
`agent: "all"` rows. Use `--source copilot` to filter to one adapter, or
`--by-source` to emit one row per source per period.

## Data Sources

The v1 adapters cover the ccusage all-agent sources used by the diff harness:

- Claude
- Codex
- OpenCode
- Amp
- Droid
- Codebuff
- Hermes
- pi
- Goose
- OpenClaw
- Kilo
- Copilot
- Gemini
- Kimi
- Qwen
- Antigravity placeholder discovery

Copilot defaults to `~/.copilot/session-state/*/events.jsonl`, matching the
team path convention. The ccusage diff harness disables that source by default
because ccusage does not currently read Copilot session-state files.

`blocks` intentionally follows ccusage's current behavior and reports Claude
session blocks only.

## Development

This is a standard TypeScript build:

```bash
npm install
npm run build
npm test
```

SQLite-backed adapters use Node's built-in `node:sqlite` when available. If a
local environment has `better-sqlite3` installed, the runtime can use it
dynamically, but it is not a package dependency.

Run live compatibility checks against a local or globally installed ccusage:

```bash
npm run diff:ccusage -- daily weekly monthly session
CCUSAGE_ROOT=/path/to/ccusage npm run diff:ccusage -- blocks
```

The diff script builds `usagetoken`, runs both CLIs with matching JSON options,
normalizes ordering and floating point noise, then reports field-level
differences.

## Packaging

The package whitelist only includes compiled runtime files:

- `dist/bin`
- `dist/src`
- `README.md`
- `LICENSE`

Development-only files such as `src/`, `test/`, `scripts/`, and `dist/test/`
are excluded from the packed CLI.

## License and Attribution

This project is released under the MIT License.

`usagetoken` uses `ccusage` as a compatibility oracle for JSON shape, aggregation
behavior, and pricing snapshots. `ccusage` is also MIT licensed; see the upstream
project for its original implementation and license notice.
