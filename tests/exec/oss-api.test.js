import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { once } from 'node:events';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';

test('ollama schema exposes chat, generate, and tags endpoints', async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-oss-test-'));
  const homeDir = path.join(tmpRoot, 'home');
  await fs.mkdir(homeDir, { recursive: true });
  const configDir = path.join(homeDir, '.copilot-cli');
  await fs.mkdir(configDir, { recursive: true });

  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  const profileId = 'oss-profile';
  const now = Date.now();

  const profiles = {
    [profileId]: {
      id: profileId,
      token: 'ghp_test_token',
      githubToken: 'gho_test',
      provider: 'github',
      timestamp: now,
      models: ['gpt-4'],
      user: {
        id: 1,
        login: 'oss-user',
        name: 'OSS User',
        email: 'oss@example.com',
        avatar_url: 'https://example.com/avatar.png'
      }
    }
  };

  const catalogState = {
    version: 1,
    updatedAt: now,
    entries: {
      [profileId]: {
        profileId,
        updatedAt: now,
        lastAttemptAt: now,
        ttlMs: 60_000,
        models: ['gpt-4', 'gpt-4o'],
        rawModels: [],
        status: 'ready',
        source: 'manual',
        stats: {
          total: 2,
          working: 2,
          failed: 0,
          durationMs: 0,
          validated: true
        }
      }
    }
  };

  await fs.writeFile(path.join(configDir, 'profiles.json'), JSON.stringify(profiles, null, 2));
  await fs.writeFile(path.join(configDir, 'active-profile'), profileId, 'utf8');
  await fs.writeFile(path.join(configDir, 'model-catalog.json'), JSON.stringify(catalogState, null, 2));

  const previousDispatcher = getGlobalDispatcher();
  const agent = new MockAgent();
  agent.disableNetConnect();
  agent.enableNetConnect(/127\.0\.0\.1/);
  const pool = agent.get('https://api.githubcopilot.com');
  pool
    .intercept({ path: '/chat/completions', method: 'POST' })
    .reply(200, () => ({
      id: 'mocked-chat',
      object: 'chat.completion',
      model: 'mocked-upstream',
      created: Math.floor(Date.now() / 1000),
      choices: [
        {
          message: { role: 'assistant', content: 'mock-hello' },
          finish_reason: 'stop',
          index: 0
        }
      ]
    }))
    .persist();
  setGlobalDispatcher(agent);

  const { createApiServer } = await import('../../dist/api/server.js');
  const app = createApiServer('ghp_test_token', 'ollama');
  const server = app.listen(0);
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object', 'server should expose address information');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    setGlobalDispatcher(previousDispatcher);
    await agent.close();
    process.env.HOME = originalHome;
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const rootResponse = await fetch(`${baseUrl}/`);
  assert.strictEqual(rootResponse.status, 200);
  const rootPayload = await rootResponse.json();
  assert.strictEqual(rootPayload.status, 'ok');
  assert.strictEqual(rootPayload.message, 'GitHub Copilot OSS proxy is running');
  assert.deepStrictEqual(rootPayload.endpoints, {
    chat: '/api/chat',
    generate: '/api/generate',
    models: '/api/tags'
  });

  const versionResponse = await fetch(`${baseUrl}/api/version`);
  assert.strictEqual(versionResponse.status, 200);
  const versionPayload = await versionResponse.json();
  assert.ok(versionPayload.version);

  const healthResponse = await fetch(`${baseUrl}/api/health`);
  assert.strictEqual(healthResponse.status, 200);
  const healthPayload = await healthResponse.json();
  assert.strictEqual(healthPayload.status, 'ok');

  const chatResponse = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello there' }],
      stream: false
    })
  });
  assert.strictEqual(chatResponse.status, 200);
  const chatPayload = await chatResponse.json();
  assert.strictEqual(chatPayload.done, true);
  assert.strictEqual(chatPayload.message?.content, 'mock-hello');

  const generateResponse = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4',
      prompt: 'Say hello in one word',
      stream: false
    })
  });
  assert.strictEqual(generateResponse.status, 200);
  const generatePayload = await generateResponse.json();
  assert.strictEqual(generatePayload.done, true);
  assert.strictEqual(generatePayload.response, 'mock-hello');

  const tagsResponse = await fetch(`${baseUrl}/api/tags`);
  assert.strictEqual(tagsResponse.status, 200);
  const tagsPayload = await tagsResponse.json();
  assert.ok(Array.isArray(tagsPayload.models));
  assert.ok(
    tagsPayload.models.some((entry) => entry.name === 'gpt-4'),
    'tags response should surface catalog models'
  );
});
