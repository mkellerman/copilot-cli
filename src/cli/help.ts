export const authHelp = `
copilot-cli auth

Manage GitHub Copilot authentication profiles

USAGE
  copilot-cli auth <subcommand>

SUBCOMMANDS
  login           Authenticate with GitHub Copilot (device flow)
  logout [id]     Remove authentication profile (current or specific)
  list            List all authentication profiles
  switch <id>     Switch to a specific authentication profile
  status          Check current authentication status
  refresh         Refresh current authentication token

EXAMPLES
  $ copilot-cli auth login              # Authenticate via device flow
  $ copilot-cli auth list               # List all profiles
  $ copilot-cli auth switch vscode-username   # Switch to specific profile
  $ copilot-cli auth status             # Check current auth status
  $ copilot-cli auth logout             # Remove current profile
  $ copilot-cli auth logout vscode-username   # Remove specific profile
  $ copilot-cli auth refresh            # Refresh current token
`;

export const apiHelp = `
copilot-cli api

Manage OpenAI-compatible API server

USAGE
  copilot-cli api <subcommand> [options]

SUBCOMMANDS
  start           Start the API server
  stop            Stop the API server
  restart         Restart the API server
  status          Show API server status

OPTIONS
  -p, --port      Server port (default: 3000)
  -H, --host      Server host (default: localhost)
  --token         Override authentication token
  --background    Run server in background
  --debug         Enable debug logging

EXAMPLES
  $ copilot-cli api start                    # Start on default port
  $ copilot-cli api start --port 8080        # Start on port 8080
  $ copilot-cli api start --background       # Run in background
  $ copilot-cli api stop                     # Stop the server
  $ copilot-cli api restart                  # Restart the server
  $ copilot-cli api status                   # Check if running
`;

export const mcpHelp = `
copilot-cli mcp

Manage Model Context Protocol server

USAGE
  copilot-cli mcp <subcommand> [options]

SUBCOMMANDS
  start           Start the MCP server
  stop            Stop the MCP server
  restart         Restart the MCP server
  status          Show MCP server status

OPTIONS
  --transport     Transport type: stdio (default), tcp, or sse
  --port          Port for TCP/SSE transport (default: 9000)
  --background    Run server in background
  --debug         Enable debug logging

EXAMPLES
  $ copilot-cli mcp start                              # Start with stdio
  $ copilot-cli mcp start --transport tcp              # Start TCP on 9000
  $ copilot-cli mcp start --transport tcp --port 8500  # Start TCP on 8500
  $ copilot-cli mcp start --transport sse --port 3001  # Start SSE on 3001
  $ copilot-cli mcp start --background                 # Run in background
  $ copilot-cli mcp stop                               # Stop the server
  $ copilot-cli mcp restart                            # Restart the server
  $ copilot-cli mcp status                             # Check if running
`;

export const configHelp = `
copilot-cli config

Manage copilot-cli configuration

USAGE
  copilot-cli config <subcommand> [options]

SUBCOMMANDS
  get <key>       Get configuration value
  set <key>       Set configuration value
  list            Show all configuration
  reset           Reset to defaults

CONFIGURATION KEYS
  api.port        Default API server port (3000)
  api.host        Default API server host (localhost)
  mcp.transport   MCP transport type (stdio|tcp|sse)
  mcp.port        Default MCP TCP port (9000)
  debug           Enable debug logging (true|false)

EXAMPLES
  $ copilot-cli config list                  # Show all config
  $ copilot-cli config get api.port          # Get specific value
  $ copilot-cli config set api.port 8080     # Set port to 8080
  $ copilot-cli config reset                 # Reset to defaults
`;

export const statusHelp = `
copilot-cli status

Show status of running services and authentication

USAGE
  copilot-cli status [options]

OPTIONS
  --json          Output in JSON format
  --verbose       Show detailed information

OUTPUT
  • Authentication status
  • API server status (running/stopped, port, uptime)
  • MCP server status (running/stopped, transport, uptime)
  • Active connections count
  • Resource usage (if --verbose)

EXAMPLES
  $ copilot-cli status                       # Show status
  $ copilot-cli status --json                # JSON output
  $ copilot-cli status --verbose             # Detailed info
`;

export const modelHelp = `
copilot-cli model

Manage Copilot model selection

USAGE
  copilot-cli model <subcommand>

SUBCOMMANDS
  list            List cached working models
  refresh         Fetch and test all models, update cache
  set [model]     Set default model (interactive if no model specified)
  info            Show current model configuration

EXAMPLES
  $ copilot-cli model list                   # List cached working models
  $ copilot-cli model refresh                # Re-test all models and update cache
  $ copilot-cli model set                    # Interactive model selection
  $ copilot-cli model set gpt-4              # Set default to gpt-4
  $ copilot-cli model info                   # Show current model
`;