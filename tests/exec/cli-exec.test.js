import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createTestContext,
  writeClaudeStub,
  runCopilot,
  readMockEvents,
  readModelCatalog,
  findLatestLog,
  readFileIfExists,
  extractJsonPayload
} from './helpers.js';
import { createClaudeMultiStub } from './stubs.js';

const CLAUDE_MULTI_STUB = createClaudeMultiStub();

function assertChatModel(events, expected) {
  const chatEvents = events.filter((event) => event.event === 'chat-completion');
  assert.ok(chatEvents.length > 0, 'expected at least one chat-completion event');
  const last = chatEvents[chatEvents.length - 1];
  assert.strictEqual(last.payload?.model, expected, `expected upstream model ${expected}`);
}

test('prefetches models and falls back to default when unknown anthropic model is requested', async (t) => {
  const context = await createTestContext(t);
  const stubPath = await writeClaudeStub(context, CLAUDE_MULTI_STUB);
  const result = await runCopilot(
    context,
    ['exec', '--verbose', '2', stubPath, '-p', '--help'],
    { env: { CLAUDE_TEST_MODEL: 'claude-unknown' }, mockResponseText: 'fallback-response' }
  );
  assert.strictEqual(result.exitCode, 0, `stderr: ${result.stderr}`);
  const payload = extractJsonPayload(result.stdout);
  const textContent = Array.isArray(payload.payload?.content)
    ? payload.payload.content[0]?.text
    : payload.payload?.content;
  assert.strictEqual(textContent, 'fallback-response', 'stub should print upstream text');

  const events = await readMockEvents(context);
  assert.ok(events.some((event) => event.event === 'list-models'), 'should fetch models during bootstrap');
  assertChatModel(events, 'gpt-4');

  const catalog = await readModelCatalog(context);
  assert.ok(catalog, 'model catalog should have been written');
  const entryValues = Object.values(catalog.entries ?? {});
  assert.ok(entryValues.length >= 1, 'catalog should contain profile entry');

  const latestLog = await findLatestLog(context.workDir);
  assert.ok(latestLog, 'verbose log file should be created');
});


test('changing default model persists across exec sessions', async (t) => {
  const context = await createTestContext(t);
  const stubPath = await writeClaudeStub(context, CLAUDE_MULTI_STUB);

  const setResult = await runCopilot(context, ['profile', 'set', 'model.default', 'gpt-4o-mini']);
  assert.strictEqual(setResult.exitCode, 0, `stderr: ${setResult.stderr}`);

  await fs.rm(context.mockLog, { force: true });

  const first = await runCopilot(
    context,
    ['exec', '--verbose', '2', stubPath, '-p', 'first run'],
    { env: { CLAUDE_TEST_MODEL: 'claude-unknown' }, mockResponseText: 'first-response' }
  );
  assert.strictEqual(first.exitCode, 0, `stderr: ${first.stderr}`);
  let payload = extractJsonPayload(first.stdout);
  let text = Array.isArray(payload.payload?.content)
    ? payload.payload.content[0]?.text
    : payload.payload?.content;
  assert.strictEqual(text, 'first-response');

  let events = await readMockEvents(context);
  assertChatModel(events, 'gpt-4o-mini');

  await fs.rm(context.mockLog, { force: true });

  const second = await runCopilot(
    context,
    ['exec', '--verbose', '2', stubPath, '-p', 'second run'],
    { env: { CLAUDE_TEST_MODEL: 'claude-unknown' }, mockResponseText: 'second-response' }
  );
  assert.strictEqual(second.exitCode, 0, `stderr: ${second.stderr}`);
  payload = extractJsonPayload(second.stdout);
  text = Array.isArray(payload.payload?.content)
    ? payload.payload.content[0]?.text
    : payload.payload?.content;
  assert.strictEqual(text, 'second-response');

  events = await readMockEvents(context);
  assertChatModel(events, 'gpt-4o-mini');

  const configFile = path.join(context.configDir, 'config.json');
  const configText = await readFileIfExists(configFile);
  assert.ok(configText && configText.includes('gpt-4o-mini'), 'persisted config should contain new default');
});
