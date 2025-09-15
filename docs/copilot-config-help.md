# copilot-cli config

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