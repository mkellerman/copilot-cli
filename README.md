# Copilot CLI

A TypeScript CLI tool that exposes GitHub Copilot as an OpenAI-compatible API proxy.

The primary binary is installed as `copilot`; a `copilot-cli` alias remains during the migration window.

## Features

- **API Proxy Server**: Exposes GitHub Copilot as an OpenAI-compatible API
- **MCP Server (stdio)**: Integrates with MCP-aware IDEs/CLIs via `/copilot` tools
- **CLI Tool**: Manage authentication, configuration, and model selection

## Installation

```bash
npm install
npm run build
npm link
```

## Usage

### Authenticate & Manage Profiles

```bash
# Authenticate using GitHub device flow
copilot profile login

# Pick a specific provider
copilot profile login --provider vscode

# Inspect authentication + model status (JSON output supported)
copilot profile status --json

# Switch or remove profiles
copilot profile switch my-profile
copilot profile logout my-profile
```

### Run the API Proxy

```bash
# Start on default port (3000) and loopback host
copilot api

# Start on custom port and suppress the banner
copilot api --port 8080 --silent

# Start Ollama-compatible endpoints on the default Ollama port (11434)
copilot api --oss

# Increase verbosity (0-3) for structured logging
copilot --verbose=2 api
```

### Quick Prompts

```bash
copilot chat "Explain monads briefly"
```

### Execute Other Tools With Copilot

```bash
# Run the Claude CLI with Copilot-backed Anthropic env vars
copilot exec claude -- -p "--help"

# Drop into a shell with OPENAI_* variables wired to the local proxy
copilot exec bash -i

# Forward requests to the local proxy with curl
copilot exec curl https://localhost:3000/v1/models
```

The `exec` command spins up a temporary proxy, injects the appropriate `ANTHROPIC_*` or `OPENAI_*` environment variables, and forwards every argument after the target binary verbatim. Legacy `copilot claude` / `copilot happy` still work but emit deprecation notices and defer to `exec`.

### Developer & MCP Commands

```bash
# Launch the MCP server over stdio (advanced)
copilot dev mcp

# Validate configuration and environment
copilot dev doctor

# Inspect or toggle request transformers (experimental)
copilot dev transforms status
copilot dev transforms enable
copilot dev transforms allow-scripts false
```

Example `mcp.json` entry:

```json
{
  "copilot": {
    "command": "copilot",
    "args": ["dev", "mcp"]
  }
}
```

Tools exposed:

- `/copilot` – proxy chat completions via GitHub Copilot
- `/copilot-auth` – report active authentication profile and model catalog status

## Project Structure

```
/
├── src/                    # TypeScript source code
│   ├── api/               # API proxy server
│   │   ├── server.ts      # Express server implementation
│   │   └── standalone.ts  # Standalone server entry
│   ├── cli/               # Current CLI implementation (api/chat/exec/profile/dev)
│   │   ├── adapters/      # Exec adapter for external tools
│   │   └── commands/      # Command handlers
│   ├── legacy-cli/        # Legacy CLI preserved during transition
│   ├── core/              # Auth, config manager, shared clients
│   ├── config/            # Configuration helpers and schema
│   └── mcp/               # MCP stdio server and tools
├── bin/                   # Executable scripts
│   ├── copilot.js        # Primary CLI entry point
│   └── cli.js            # Legacy alias (imports copilot.js)
├── dist/                  # Compiled JavaScript (generated)
├── package.json          # Project dependencies
└── tsconfig.json         # TypeScript configuration
```

## Development

```bash
# Build TypeScript
npm run build

# Development mode with watch
npm run dev

# Type checking
npm run typecheck
```

## Environment Variables

- `PORT`: API server port (legacy override)
- `DEBUG`: Enable debug logging
- `COPILOT_API_PORT`: Override API port without editing config
- `COPILOT_API_HOST`: Override API bind host
- `COPILOT_MODEL_DEFAULT`: Override default model id
- `COPILOT_MODEL_REFRESH_MINUTES`: Model cache refresh interval
- `COPILOT_CATALOG_TTL_MINUTES`: Cached model TTL in minutes
- `COPILOT_CATALOG_STALE_MINUTES`: Minutes before cached models reported as stale
- `COPILOT_DEBUG`: Enable debug logging globally (`true`/`false`)
- `COPILOT_VERBOSE`: Default verbose level when CLI flag is omitted
- `COPILOT_LOG_FILE`: Path for verbose log output when level > 0
