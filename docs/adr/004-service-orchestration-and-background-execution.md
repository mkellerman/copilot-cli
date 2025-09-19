# ADR-004 Service Orchestration and Background Execution

- Status: Superseded (2025-09-18)
- Date: 2025-09-18
- Deciders: Copilot CLI core team
- Tags: operations, process-management, developer-experience

## Context
Background services use ad-hoc PID files, manual `child_process` spawning, and direct `process.exit` calls inside library code. This makes cross-platform management brittle, complicates graceful shutdown, and blocks reuse of modules in other runtimes or tests.

## Decision
Introduce a unified `ServiceOrchestrator` that manages foreground/background processes, tracks health via IPC heartbeats, and exposes a typed lifecycle API. CLI commands throw errors upward; the CLI entry point maps them to exit codes. PID/log management is replaced with structured state files and optional worker-thread supervision.

**Update (Superseded):** The repository has since removed the orchestrator in favor of a simpler foreground `copilot-cli api` command. This ADR is retained for historical context only.

## Consequences
- Provides consistent lifecycle control and enables embedding into IDE or daemon hosts.
- Requires refactoring CLI commands to remove direct `process.exit` usage.
- Adds infrastructure for future services (model catalog, MCP, API proxy) to share orchestration primitives.
- Demands additional observability to surface health state and restart logic.

## Implementation Details (PM Review)
- Deliverables: orchestrator module, refactored CLI commands, health/status command UX, regression tests covering start/stop/restart flows.
- Dependencies: Node 18+ features (AbortController, worker threads), logging strategy alignment.
- Effort Estimate: ~1.5 sprints due to breadth of refactor.
- Risks & Mitigations: migration complexity (ship feature flag to toggle new manager, maintain compatibility layer during transition); cross-platform disparities (add CI matrix testing for macOS/Linux/Windows).
