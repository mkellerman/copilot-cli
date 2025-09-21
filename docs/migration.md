# Copilot CLI Migration Guide

This guide enumerates the changes between the legacy CLI surface (`copilot-cli`) and the new streamlined interface (`copilot`).

## New Top-Level Commands

| Legacy | Replacement |
| ------ | ----------- |
| `copilot-cli api` | `copilot api` |
| `copilot-cli chat` | `copilot chat` |
| `copilot-cli claude …` | `copilot exec claude …` |
| `copilot-cli happy …` | `copilot exec happy …` |
| `copilot-cli auth …` | `copilot profile …` |
| `copilot-cli config …` | `copilot profile get/set …` |
| `copilot-cli model …` | `copilot profile refresh` / `copilot profile set model.default …` |
| `copilot-cli mcp` | `copilot dev mcp` |
| `copilot-cli config doctor` | `copilot dev doctor` |

The legacy entry point (`copilot-cli`) now aliases the new binary so existing scripts continue to launch the CLI. Deprecated commands remain available for one transition release; they emit deprecation notices and forward to the new handlers when possible.

## Key Behavioral Changes

- **Single profile namespace** — Authentication, configuration, and model management co-exist under `copilot profile`.
- **Exec wrapper** — The new `exec` command injects Copilot/Anthropic environment variables and eliminates bespoke wrappers for each target CLI.
- **Verbose logging** — A single `--verbose 0-3` flag is respected by every command. Levels above zero also set `COPILOT_LOG_FILE` automatically.
- **Transforms tooling** — Experimental transformer management is grouped under `copilot dev transforms`.

## Configuration Keys

The following keys are available via `copilot profile set <key> <value>`:

- `api.port`
- `api.host`
- `model.default`
- `model.refreshIntervalMinutes`
- `catalog.ttlMinutes`
- `catalog.staleMinutes`
- `debug`
- `transforms.enabled`
- `transforms.allowScripts`

Boolean values accept `true|false`; numeric values are automatically clamped to sensible ranges.

## Recommended Next Steps

1. Alias `copilot` in shell scripts instead of `copilot-cli`.
2. Replace direct `claude`/`happy` invocations with `copilot exec …` to benefit from the shared adapter.
3. Use `copilot profile status --json` for machine-readable diagnostics instead of bespoke auth parsing.
4. Enable verbose logging (`--verbose=1..3`) to capture structured logs during troubleshooting.

Questions or issues? Run `copilot dev doctor` to validate configuration, or inspect the new `docs/spec.md` for the complete command surface.
