# ADR-003 Model Availability Strategy

- Status: Approved
- Date: 2025-09-18
- Deciders: Copilot CLI core team
- Tags: performance, reliability, telemetry

## Context
Model availability is determined synchronously during API requests by calling `/models` and POSTing chat completions for every candidate. This approach blocks the event loop, produces excessive upstream calls, increases rate-limit risk, and spams stdout with progress markers.

## Decision
Create a background "model catalog" service that periodically (or on demand) fetches `/models`, optionally performs throttled validation, and stores results with freshness metadata in the profile store. API responses return cached data and include cache timestamps. CLI commands (`model refresh`) trigger manual updates with progress feedback.

## Consequences
- Removes expensive work from customer-facing API requests.
- Introduces eventual consistency; cache stale windows must be communicated to users.
- Requires persistent storage for catalog metadata and scheduling logic for refreshes.
- Facilitates richer telemetry on model availability and failure reasons.

## Implementation Details (PM Review)
- Deliverables: catalog scheduler/background worker, persistence schema extensions, CLI UX for cache state, monitoring dashboards for refresh success rates.
- Dependencies: TokenStore from ADR-001, Service Orchestrator from ADR-004.
- Effort Estimate: ~1 sprint including worker runtime and UX updates.
- Risks & Mitigations: stale data (expose last-refresh timestamps and manual refresh command); background task failures (add alerting and retries).
