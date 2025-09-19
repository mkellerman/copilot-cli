# Copilot CLI

A TypeScript CLI tool that exposes GitHub Copilot as an OpenAI-compatible API proxy.

## Features

- **API Proxy Server**: Exposes GitHub Copilot as an OpenAI-compatible API
- **CLI Tool**: Manage authentication, configuration, and model selection

## Installation

```bash
npm install
npm run build
npm link
```

## Usage

### Authentication

```bash
# Authenticate using GitHub device flow
copilot-cli auth login

# Or manually enter a token
copilot-cli auth login --manual

# Check authentication status
copilot-cli auth status

# Remove authentication
copilot-cli auth logout
```

### Run the API Proxy

```bash
# Start on default port (3000)
copilot-cli api

# Start on custom port
copilot-cli api --port 8080

# Start with debug logging
copilot-cli api --debug
```

### Configuration

```bash
# Show merged configuration
copilot-cli config list

# Validate configuration file and environment overrides
copilot-cli config doctor

# Update a setting
copilot-cli config set api.port 8080
```

## Project Structure

```
/
├── src/                    # TypeScript source code
│   ├── api/               # API proxy server
│   │   ├── server.ts      # Express server implementation
│   │   └── standalone.ts  # Standalone server entry
│   ├── cli/               # CLI implementation
│   │   └── index.ts       # CLI commands
│   ├── core/              # Core functionality
│   │   └── auth.ts        # GitHub authentication
│   └── config/            # Configuration
│       └── index.ts       # Config management
├── bin/                   # Executable scripts
│   └── cli.js            # CLI entry point
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
