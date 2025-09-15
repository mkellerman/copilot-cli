# copilot-cli api

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