# ADR-005 Configuration Management and Validation

- Status: Approved
- Date: 2025-09-18
- Deciders: Copilot CLI core team
- Tags: configuration, reliability, tooling

## Context
Configuration merging currently overwrites entire sections when a single field is set, lacks schema validation, and is tightly coupled to filesystem storage. There is no support for environment overrides or multi-instance scenarios, leading to brittle user experiences.

## Decision
Adopt a typed configuration schema (e.g., `zod`) with layered sources: defaults → config file → environment variables → CLI flags. Merge operations are deep, preserving unspecified defaults. Provide a `config doctor` command to surface validation issues and allow remote configuration injection for managed deployments.

## Consequences
- Reduces misconfiguration by validating input early and preserving defaults.
- Adds dependency on a schema library and requires migration for existing config files.
- Enables richer automation by supporting environment-variable overrides and typed accessors.
- Simplifies adding new configuration fields without fear of breaking legacy setups.

## Implementation Details (PM Review)
- Deliverables: configuration schema module, layered loader, CLI updates (`config doctor`, richer errors), migration guide for legacy configs.
- Dependencies: TokenStore secure path awareness, logging improvements from ADR-004 for surfaced errors.
- Effort Estimate: ~0.5 sprint with parallel test harness updates.
- Risks & Mitigations: breaking existing configs (include auto-migration and fallback to legacy loader via feature flag); schema drift (add contract tests and lint rule enforcing schema usage).
