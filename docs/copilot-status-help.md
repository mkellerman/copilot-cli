# copilot-cli status

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

SAMPLE OUTPUT
  Authentication: ✓ Active (token: ghu_****XyZ)
  
  Services:
    API Server:  ✓ Running (port 3000, uptime: 2h 15m)
    MCP Server:  ✗ Stopped
  
  Active connections: 3