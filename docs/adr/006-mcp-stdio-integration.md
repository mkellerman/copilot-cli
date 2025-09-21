# ADR-006 MCP Stdio Integration

- Status: Proposed
- Date: 2025-09-19
- Deciders: Copilot CLI core team
- Tags: mcp, cli, interoperability

## Context

Developers increasingly expect a single Copilot binary they can drop into an `mcp.json` and use from any MCP-aware IDE or CLI. The repository previously experimented with a background `ServiceOrchestrator` and a multi-command `copilot-cli mcp` surface, but that approach was heavy, hard to configure, and eventually removed. Today the CLI focuses on the OpenAI-compatible API proxy, leaving no simple path for MCP hosts that speak stdio.

## Decision

Reintroduce an MCP server as a single foreground command:

- Add `copilot-cli mcp` which launches an MCP server over `stdin`/`stdout` using `@modelcontextprotocol/sdk`'s `StdioServerTransport`.
- Structure the MCP module as a plug-and-play registry so additional tools can be added easily. Initially expose two tools:
  - `/copilot`: proxies chat completions via the existing Copilot HTTP client and model catalog.
  - `/copilot-auth`: reports authentication status (active profile, models cache freshness) and surfaces remediation messages if no valid token is available.
- Reuse the existing config/auth stack (profiles under `~/.copilot-cli`) and allow environment overrides for headless hosts.
- Keep the process in the foreground; terminate on stdio EOF or signals. No background orchestration, PID files, or extra service management.

## Consequences

- Reintroduces a dependency on `@modelcontextprotocol/sdk` and a small MCP runtime footprint.
- CLI help/docs must describe the new command and how to reference it from an `mcp.json`.
- Testing now includes a basic MCP smoke test (invoking `copilot-cli mcp` with mocked stdio) in addition to the API proxy checks.
- Future tools can be registered by dropping additional modules into the MCP tool registry without touching the CLI or server bootstrap.

## Alternatives Considered

1. **Expose only the HTTP proxy:** would keep surface area minimal but forces every host to implement HTTP bridging and auth negotiation separately.
2. **Revive the old ServiceOrchestrator design:** provides background lifecycle management but reintroduces significant complexity and cross-platform risk for little benefit.
3. **Rely on third-party wrappers:** delegates responsibility to external projects but fragments the user experience and drifts from the official CLI.

The foreground stdio approach keeps the CLI lean while unlocking MCP interoperability for IDEs and other CLIs.

## Implementation Notes

- Place MCP code under `src/mcp/` with a small server bootstrap (`index.ts`) and a `tools/` folder.
- The tool handlers should call into the shared Copilot HTTP client (`CopilotHttpClient`), model catalog, and auth helpers.
- Error responses should use MCP's structured error payloads so hosts can display meaningful remediation steps (e.g., "run `copilot-cli auth login`").
- Add integration examples to the README showing how to reference the binary from an MCP configuration file.
