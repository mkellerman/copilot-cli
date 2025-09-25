Test helpers and mock setup
==========================

This repository's exec integration tests spawn child Node processes (the CLI + provider stubs).
To ensure those children use the in-process undici MockAgent (instead of hitting real upstream
endpoints), the test harness preloads a small CommonJS loader into spawned Node processes via
NODE_OPTIONS. The loader dynamically imports the ESM mock implementation (tests/exec/mock-copilot.js)
using a file:// URL so it is compatible with Node 18 and newer.

Why we do this
- The mock registers an undici MockAgent via setGlobalDispatcher(). Child processes must have
  that same dispatcher registered to intercept outgoing HTTP requests they make.
- Preloading via NODE_OPTIONS keeps the change scoped to test runs (the loader is not used in
  production runs; it's only set by `tests/exec/helpers.js` when spawning children).

If CI environments prohibit `-r` preloads, we can switch to a tiny wrapper script that imports the
mock before spawning the CLI instead. See `tests/exec/mock-copilot-loader.cjs` for the current loader.
