export function createClaudeMultiStub() {
  return `#!/usr/bin/env node
import process from 'node:process';

const args = process.argv.slice(2);

function requirePrompt() {
  const pIndex = Math.max(args.indexOf('-p'), args.indexOf('--print'));
  if (pIndex === -1) {
    console.error('missing -p/--print flag');
    process.exit(1);
  }
  let promptIndex = pIndex + 1;
  if (args[promptIndex] === '--') {
    promptIndex += 1;
  }
  const prompt = args[promptIndex];
  if (prompt === undefined) {
    console.error('missing prompt value');
    process.exit(1);
  }
  return prompt;
}

const prompt = requirePrompt();
const mode = process.env.CLAUDE_STUB_MODE || 'api';

if (mode === 'inspect') {
  const output = {
    mode,
    prompt,
    argv: args,
    env: {
      COPILOT_VERBOSE: process.env.COPILOT_VERBOSE ?? null,
      COPILOT_LOG_FILE: process.env.COPILOT_LOG_FILE ?? null,
      COPILOT_EXEC_PROVIDER: process.env.COPILOT_EXEC_PROVIDER ?? null,
      COPILOT_API_BASE_URL: process.env.COPILOT_API_BASE_URL ?? null,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? null,
      ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN ?? null
    }
  };
  console.log(JSON.stringify(output));
  process.exit(0);
}

const baseUrl = process.env.ANTHROPIC_API_URL || process.env.ANTHROPIC_BASE_URL;
if (!baseUrl) {
  console.error('missing ANTHROPIC API url');
  process.exit(1);
}

const model = process.env.CLAUDE_TEST_MODEL || 'claude-unknown';
const payload = {
  model,
  messages: [{ role: 'user', content: prompt }],
  max_tokens: 128,
  temperature: 0.1,
  stream: false
};

let response;
try {
  response = await fetch(baseUrl + '/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
} catch (error) {
  const output = {
    mode,
    prompt,
    status: 0,
    fetchError: error?.message || String(error),
    env: {
      COPILOT_VERBOSE: process.env.COPILOT_VERBOSE ?? null,
      COPILOT_EXEC_PROVIDER: process.env.COPILOT_EXEC_PROVIDER ?? null
    }
  };
  console.log(JSON.stringify(output));
  process.exit(1);
}

let json;
try {
  json = await response.json();
} catch (error) {
  json = { parseError: error?.message || String(error) };
}

const output = {
  mode,
  prompt,
  status: response.status,
  payload: json,
  env: {
    COPILOT_VERBOSE: process.env.COPILOT_VERBOSE ?? null,
    COPILOT_LOG_FILE: process.env.COPILOT_LOG_FILE ?? null,
    COPILOT_EXEC_PROVIDER: process.env.COPILOT_EXEC_PROVIDER ?? null,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? null,
    ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN ?? null
  }
};

console.log(JSON.stringify(output));
`;
}
