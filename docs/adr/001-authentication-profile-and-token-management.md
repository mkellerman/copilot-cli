# ADR-001 Authentication Profile & Token Management

- Status: Approved
- Date: 2025-09-18
- Deciders: Copilot CLI core team
- Tags: security, authentication, developer-experience

## Context
Current authentication flows persist GitHub and Copilot tokens in plaintext files, echo partial tokens to stdout, and tightly couple the device authorization experience to CLI commands. This hinders re-use from other clients, prevents headless automation, and risks credential exposure through logs.

## Decision
Introduce a dedicated `TokenStore` abstraction that owns credential lifecycle. The CLI and background services request tokens exclusively through this interface. Implement OS keychain integrations (Keychain/DPAPI/libsecret) with an encrypted file fallback. Authentication flows produce typed profile records stored via the abstraction. Token material is never rendered in console output or logs.

## Consequences
- Enables alternative front-ends and integrations to share auth safely.
- Reduces credential leakage risk by removing plaintext files and log output.
- Requires adapters per platform and migration tooling for existing users.
- Simplifies unit testing by allowing in-memory token stores.

## Implementation Details (PM Review)
- Deliverables: token-store library, migration command, updated auth CLI UX, documentation for rollout and fallback modes.
- Dependencies: platform keychain APIs, legacy profile migration script, security review.
- Effort Estimate: ~2 sprints with parallel security sign-off.
- Risks & Mitigations: keychain access on headless servers (mitigate via encrypted file fallback); migration issues (ship dry-run validator and telemetry).
