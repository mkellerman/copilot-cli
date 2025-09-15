# copilot-cli mcp

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