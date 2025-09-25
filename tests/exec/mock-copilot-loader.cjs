// CommonJS loader that dynamically imports the ESM mock-copilot.js so it can be
// preloaded into child Node processes via NODE_OPTIONS -r.
const path = require('node:path');

(async () => {
  try {
    const esm = path.join(__dirname, 'mock-copilot.js');
    // Dynamic import of the ESM mock file. Using a filesystem path works in
    // recent Node versions for dynamic import from CJS.
    await import(esm);
  } catch (err) {
    // If the loader fails, print a helpful message. Tests should fail early
    // rather than silently hitting real upstream endpoints.
    // eslint-disable-next-line no-console
    console.error('Failed to preload mock-copilot ESM module:', err && err.stack ? err.stack : err);
    // Don't exit the process immediately; let the test harness decide. Still
    // throw so child processes will see the failure if they rely on the mock.
    throw err;
  }
})();
