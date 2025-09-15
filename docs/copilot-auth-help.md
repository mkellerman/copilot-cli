# copilot-cli auth

Manage GitHub Copilot authentication

USAGE
  copilot-cli auth <subcommand> [options]

SUBCOMMANDS
  login           Authenticate with GitHub Copilot (device flow)
  logout          Remove stored authentication
  status          Check authentication status
  refresh         Refresh authentication token

OPTIONS (login)
  --provider      Specify provider: vscode, copilot, gh-cli, jetbrains, sublime

PROVIDERS
  vscode          Visual Studio Code (widely trusted)
  copilot         GitHub Copilot Plugin (minimal permissions)
  gh-cli          GitHub CLI (official)
  jetbrains       JetBrains IDEs
  sublime         Sublime Text

EXAMPLES
  $ copilot-cli auth login                      # Interactive provider selection
  $ copilot-cli auth login --provider vscode    # Use VS Code provider
  $ copilot-cli auth login --provider copilot   # Minimal permissions
  $ copilot-cli auth status                     # Check authentication
  $ copilot-cli auth logout                     # Remove authentication
  $ copilot-cli auth refresh                    # Refresh token