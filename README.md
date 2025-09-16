# Copilot CLI

A TypeScript CLI tool that exposes GitHub Copilot as an OpenAI-compatible API and MCP server.

## Features

- **API Proxy Server**: Exposes GitHub Copilot as an OpenAI-compatible API
- **MCP Server**: Model Context Protocol server for Copilot integration
- **CLI Tool**: Command-line interface for managing authentication and servers

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

### Start API Proxy Server

```bash
# Start on default port (3000)
copilot-cli api start

# Start on custom port
copilot-cli api start -p 8080

# Start with debug logging
copilot-cli api start --debug
```

### Start MCP Server

```bash
copilot-cli mcp start
```

## Project Structure

```
/
├── src/                    # TypeScript source code
│   ├── api/               # API proxy server
│   │   ├── server.ts      # Express server implementation
│   │   └── standalone.ts  # Standalone server entry
│   ├── mcp/               # MCP server
│   │   ├── index.ts       # MCP server entry
│   │   └── tools/         # MCP tool implementations
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

- `PORT`: API server port (defaults to configured value or 3000)
- `DEBUG`: Enable debug logging