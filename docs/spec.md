# Copilot CLI Specification

## Purpose

The Copilot CLI exposes GitHub Copilot Chat as an OpenAI-compatible API and provides tooling to:

1. Run a local proxy (`api`).
2. Issue quick prompts (`chat`).
3. Execute other CLIs/tools with Copilot/Anthropic environment injection (`exec`).
4. Manage authentication, configuration, and models (`profile`).
5. Support advanced and developer-oriented features (`dev`).

The design goal is simplicity: fewer commands, fewer flags, and a predictable mental model.

## Global Flags

All commands accept the following options:

- `--verbose <0-3>` — controls logging level.
  - `0` silent
  - `1` request summaries
  - `2` upstream tracing
  - `3` include redacted request/response bodies
- `--json` — emit machine-readable JSON where supported.
- `--help, -h` — display help.
- `--version, -v` — print the CLI version.

Environment variables (`COPILOT_VERBOSE`, `COPILOT_LOG_FILE`) are still respected but are secondary to the flags above.

## Commands

### 1. `api`

Run the local OpenAI-compatible proxy server.

**Options**

- `--port, -p <number>` — Port to bind (default: `3000`).
- `--token <string>` — Override the Copilot token.
- `--silent` — Suppress the startup banner.

**Examples**

```bash
copilot api --port 3100
COPILOT_LOG_FILE=./logs/proxy.log copilot --verbose=2 api
```

### 2. `chat`

Send a single non-streaming prompt to Copilot.

**Usage**

```bash
copilot chat <prompt...>
```

**Example**

```bash
copilot chat "Explain monads briefly"
```

### 3. `exec`

Execute another CLI/tool with Copilot/Anthropic environment injection. This replaces the previous `claude` and `happy` wrappers.

**Usage**

```bash
copilot exec <command> [args...]
```

- The first positional argument is the program (`claude`, `happy`, `bash`, etc.).
- All remaining arguments are forwarded untouched.
- Global flags must appear before `exec`.

Both of the following forms are valid; the optional `--` is ignored by Copilot and forwarded to the child process.

```bash
copilot exec claude -p "--help"
copilot exec claude -- -p "--help"
```

**Examples**

```bash
copilot exec claude -p "--help"
copilot exec happy --model anthropic:claude-3-haiku
copilot exec bash -i
copilot exec curl https://localhost:3000/v1/models
```

### 4. `profile`

Manage authentication, configuration, and model defaults (collapsed from the legacy `auth`, `config`, and `model` commands).

**Subcommands**

- `login [--provider <id>]` — Run the device auth flow and persist the profile.
- `logout [id]` — Remove a profile or the active one.
- `status [--json]` — Show current authentication and model status.
- `list` — List all profiles and mark the active profile.
- `switch <id>` — Switch the active profile.
- `set <key> <value>` — Update configuration (port, default model, etc.).
- `get <key>` — Print the current value.
- `refresh` — Refresh tokens and the model cache.

**Examples**

```bash
copilot profile login --provider vscode
copilot profile set model.default gpt-4o-mini
copilot profile status --json
copilot profile refresh
```

### 5. `dev`

Advanced/developer commands hidden from most users.

**Subcommands**

- `mcp [--debug]` — Run the MCP server over stdio.
- `doctor` — Validate the effective configuration and environment.
- `transforms` — Manage request transformers (experimental).

## Behavioral Notes

- Most commands require a valid Copilot token (via `profile login` or `--token`).
- `exec` injects the appropriate environment variables for Anthropic-compatible tools:
  - `ANTHROPIC_API_URL` / `ANTHROPIC_BASE_URL`
  - `ANTHROPIC_AUTH_TOKEN`
- When no token is available, placeholders are injected so downstream CLIs can still start in "local commands only" mode.
- Structured logs controlled by `--verbose` redact sensitive data at level 3.
- Model catalog refresh/TTL/stale intervals use sensible defaults, configurable via `profile set`.

## Migration Notes

- Legacy `auth`, `config`, and `model` commands are consolidated under `profile`.
- Legacy `claude` and `happy` commands are replaced by `exec`.
- `chat` and `api` retain their semantics.
- MCP, doctor, and transforms features live under the `dev` namespace.

✅ This structure delivers a cleaner surface:

- Four primary commands: `api`, `chat`, `exec`, `profile`.
- One advanced namespace: `dev`.
- No redundant wrappers or configuration sprawl.
