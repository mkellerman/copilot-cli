# GitHub Copilot CLI

USAGE
  copilot-cli <command> [options]

COMMANDS
  auth            Manage GitHub Copilot authentication
  api             Manage OpenAI-compatible API server
  mcp             Manage MCP server
  config          Manage copilot-cli configuration
  status          Show status of running services
  chat            Send a prompt to GitHub Copilot

OPTIONS
  -h, --help      Show help for command
  -v, --version   Show version

EXAMPLES
  $ copilot-cli auth login
  $ copilot-cli api start
  $ copilot-cli mcp start
  $ copilot-cli status
  $ copilot-cli chat "What is TypeScript?"

LEARN MORE
  Use 'copilot-cli <command> --help' for more information about a command.
