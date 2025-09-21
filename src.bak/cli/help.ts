export const authHelp = `
copilot-cli auth

Manage GitHub Copilot authentication profiles

USAGE
  copilot-cli auth <subcommand>

SUBCOMMANDS
  login           Authenticate with GitHub Copilot (device flow)
  inventory       Authenticate across providers and export models as CSV
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
  $ copilot-cli auth inventory --providers vscode,copilot --output models.csv
`;

export const apiHelp = `
copilot-cli api

Run the OpenAI-compatible API server

USAGE
  copilot-cli api [options]

OPTIONS
  -p, --port      Server port (default: 3000)
  --token         Override authentication token
  -d, --debug     Enable debug logging
  --silent        Suppress startup banner output

EXAMPLES
  $ copilot-cli api                # Start on default port
  $ copilot-cli api --port 8080    # Start on port 8080
  $ copilot-cli api --debug        # Enable verbose logging
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
  debug           Enable debug logging (true|false)

EXAMPLES
  $ copilot-cli config list                  # Show all config
  $ copilot-cli config get api.port          # Get specific value
  $ copilot-cli config set api.port 8080     # Set port to 8080
  $ copilot-cli config reset                 # Reset to defaults
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

export const mcpHelp = `
copilot-cli mcp

Run the MCP server over stdio so other tools can call Copilot.

USAGE
  copilot-cli mcp [options]

OPTIONS
  -d, --debug     Enable debug logging

EXAMPLES
  $ copilot-cli mcp                # Start MCP server on stdio
`;

export const claudeHelp = `
copilot-cli claude

Run the Claude CLI with ANTHROPIC_* variables wired to the Copilot proxy.

USAGE
  copilot-cli claude [<claude args...>]

EXAMPLES
  $ copilot-cli claude             # Launch claude via Copilot
  $ copilot-cli claude --help      # Show the Claude CLI help (forwarded)
  $ copilot-cli claude chat --model haiku
`;
