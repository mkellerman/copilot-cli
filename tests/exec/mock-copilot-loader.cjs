// CommonJS loader that dynamically imports the ESM mock-copilot.js so it can be
// preloaded into child Node processes via NODE_OPTIONS -r.
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  try {
    const esm = path.join(__dirname, 'mock-copilot.js');
    // Import via file:// URL for compatibility with Node 18+ where dynamic
    // import from CJS expects a valid URL. Use pathToFileURL to build the URL.
    const url = pathToFileURL(esm).href;
    await import(url);
  } catch (err) {
    // If the loader fails, print a helpful message. Tests should fail early
    // rather than silently hitting real upstream endpoints.
    // eslint-disable-next-line no-console
    console.error('Failed to preload mock-copilot ESM module:', err && err.stack ? err.stack : err);
    throw err;
  }
})();
