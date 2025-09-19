# ADR-002 OpenAI-Compatible Proxy Architecture

- Status: Approved
- Date: 2025-09-18
- Deciders: Copilot CLI core team
- Tags: api, networking, observability

## Context
The existing `/v1` OpenAI-compatible proxy already provides remote access to Copilot. However, the proxy currently relies on ad-hoc HTTPS calls, manual JSON shaping, and duplicated header constants. Inline model validation increases upstream traffic and complicates error handling. Instrumentation is minimal and streaming code is difficult to reason about.

## Decision
Centralize outbound Copilot calls through a shared HTTP client module (based on `undici` or global `fetch`) with middleware for retries, telemetry, timeout control, and consistent headers. API handlers remain thin pass-through layers that rely on the client for streaming and response shaping. Model discovery defers to the catalog defined in ADR-003, removing inline probing. This refactor reuses the existing `/v1` surface; no additional HTTP endpoints (for example, an HTTP MCP server) will be introduced.

## Consequences
- Simplifies maintenance when upstream headers or endpoints change.
- Provides a single location to add metrics, structured logging, and retry policies.
- Keeps one hardened HTTP surface, reducing security and operational overhead.
- Requires refactoring existing handlers and updating tests to consume the shared client.
- Reduces chances of event-loop blocking by delegating streaming to pipeline utilities.

## Implementation Details (PM Review)
- Deliverables: HTTP client module with middleware hooks, refactored API server handlers, integration tests against a mock Copilot endpoint, observability plumbing.
- Dependencies: Node 18+ runtime, configuration schema from ADR-005 for host/timeouts, model catalog (ADR-003).
- Effort Estimate: ~1 sprint once the client scaffolding is defined.
- Risks & Mitigations: streaming regressions (add contract tests and canary release); dependency on undici (pin version, expose interface for swapping implementations).
