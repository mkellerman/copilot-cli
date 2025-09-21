# Model Selector Bootstrap Flow

## Why
`copilot exec` currently spawns the target CLI without ensuring the API layer is warm or that we have a reliable model choice. This leads to extra latency for the first chat request and brittle behavior when the requested model name is unavailable. We want the CLI to feel instant and predictably choose a model even if the caller provides a bad hint.

## Desired Behavior
- Running `copilot exec claude -p "--help"` (or any provider command) first starts the shared API layer for both OpenAI and Anthropic.
- During bootstrap we fetch the list of available models from each provider and cache them in memory.
- We expose the required environment variables (keys, defaults, feature flags) to the spawned process so it can talk to the warmed API.
- The user command executes exactly as today, benefiting from the warmed services.
- When the API receives the first chat request we check whether the requested model exists in the cached catalog. If it does not, we silently fall back to the configured default model for that provider.

## Implementation Sketch
1. Extract the server boot logic that the daemon uses into a reusable helper (e.g. `initializeApiRuntime`). This should start adapters for OpenAI and Anthropic, configure middleware, and return handles for shutdown if needed.
2. Extend `copilot exec` so it calls this helper *before* forking the child process. Store the fetched model catalog in a singleton (`ModelRegistry`) that the API routes can consult.
3. Add a lightweight bootstrap step that populates env vars for both providers and injects them into the spawned process. This likely happens alongside the existing environment construction in `src/api/commands/index.ts`.
4. Enhance the chat request handler to validate the requested model against the cached catalog, defaulting when no match is found.
5. Ensure repeated `copilot exec` invocations reuse or gracefully tear down the bootstrap state to avoid zombie processes.

## Questions & Follow-ups
- How do we refresh the catalog if the provider list changes while the command is running?
- Should we expose telemetry/logging when we fall back to the default model so users know what happened?
- Do we need provider-specific defaults (e.g. `claude-3-5-sonnet` vs `gpt-4o-mini`) stored in config, or is a single global default sufficient?

Next step is to wire these tasks into the CLI and API code so the workflow is ready for implementation.
