#!/usr/bin/env node
import fs from 'node:fs';
import { MockAgent, setGlobalDispatcher } from 'undici';

const logFile = process.env.COPILOT_MOCK_LOG;
const modelsEnv = process.env.COPILOT_MOCK_MODELS;
const models = modelsEnv ? JSON.parse(modelsEnv) : ['gpt-4'];

const agent = new MockAgent();
agent.disableNetConnect();
agent.enableNetConnect(/127\.0\.0\.1/);
const pool = agent.get('https://api.githubcopilot.com');

function log(event, payload = {}) {
  if (!logFile) return;
  const line = JSON.stringify({ event, payload, ts: new Date().toISOString() });
  fs.appendFileSync(logFile, line + '\n', 'utf8');
}

pool.intercept({ path: '/models', method: 'GET' }).reply(200, () => {
  log('list-models');
  return {
    data: models.map((id, index) => ({ id, object: 'model', created: 1700000000 + index, owned_by: 'github-copilot' }))
  };
}).persist();

pool.intercept({ path: '/chat/completions', method: 'POST' }).reply(200, async ({ body }) => {
  let raw = '';
  if (body) {
    for await (const chunk of body) {
      raw += chunk.toString();
    }
  }
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    log('chat-completion', parsed);
  } catch (error) {
    log('chat-completion-parse-error', { raw, error: error?.message });
  }
  const responseText = process.env.COPILOT_MOCK_RESPONSE_TEXT || 'mocked-response';
  return {
    id: 'mocked-chat',
    object: 'chat.completion',
    model: 'mocked-upstream',
    created: Math.floor(Date.now() / 1000),
    choices: [
      {
        message: { role: 'assistant', content: responseText },
        finish_reason: 'stop',
        index: 0
      }
    ]
  };
}).persist();

setGlobalDispatcher(agent);
