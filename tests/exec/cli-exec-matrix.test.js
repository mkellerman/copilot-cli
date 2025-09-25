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

function readResponseText(payload) {
  if (Array.isArray(payload.payload?.content)) {
    return payload.payload.content[0]?.text ?? '';
  }
  if (typeof payload.payload?.content === 'string') {
    return payload.payload.content;
  }
  return '';
}

const fallbackScenarios = [
  {
    description: 'unknown claude falls back to default gpt-4',
    requestModel: 'claude-unknown',
    defaultModel: 'gpt-4',
    responseText: 'fallback-response-01',
    prompt: '--help',
    models: ['gpt-4', 'gpt-4o-mini'],
    verbose: '2'
  },
  {
    description: 'claude sonnet maps to gpt-4o-mini default',
    requestModel: 'claude-3-5-sonnet-20240620',
    defaultModel: 'gpt-4o-mini',
    responseText: 'fallback-response-02',
    prompt: 'usage details',
    models: ['gpt-4o-mini', 'gpt-4'],
    verbose: '3'
  },
  {
    description: 'claude opus with default gpt-4o',
    requestModel: 'claude-3-opus-20240229',
    defaultModel: 'gpt-4o',
    responseText: 'fallback-response-03',
    prompt: 'status update',
    models: ['gpt-4o', 'gpt-4'],
    verbose: '1'
  },
  {
    description: 'claude haiku to gpt-4o-mini in extended list',
    requestModel: 'claude-3-haiku-20240307',
    defaultModel: 'gpt-4o-mini',
    responseText: 'fallback-response-04',
    prompt: 'check results',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4'],
    verbose: '2'
  },
  {
    description: 'legacy claude-2 fallback to gpt-4',
    requestModel: 'claude-2',
    defaultModel: 'gpt-4',
    responseText: 'fallback-response-05',
    prompt: 'doc help',
    models: ['gpt-4', 'gpt-3.5-turbo'],
    verbose: '3'
  },
  {
    description: 'claude-3-5-haiku fallback to gpt-4o',
    requestModel: 'claude-3-5-haiku-20241022',
    defaultModel: 'gpt-4o',
    responseText: 'fallback-response-06',
    prompt: 'explain feature',
    models: ['gpt-4o', 'gpt-4o-mini'],
    verbose: '2'
  },
  {
    description: 'unknown alias fallback to gpt-4.1-mini',
    requestModel: 'claude-experimental',
    defaultModel: 'gpt-4.1-mini',
    responseText: 'fallback-response-07',
    prompt: 'test scenario',
    models: ['gpt-4.1-mini', 'gpt-4'],
    verbose: '2'
  },
  {
    description: 'custom claude fallback to gpt-4.1',
    requestModel: 'claude-enterprise',
    defaultModel: 'gpt-4.1',
    responseText: 'fallback-response-08',
    prompt: 'ping command',
    models: ['gpt-4.1', 'gpt-4'],
    verbose: '2'
  },
  {
    description: 'double colon text fallback to gpt-4',
    requestModel: 'claude-special',
    defaultModel: 'gpt-4',
    responseText: 'fallback-response-09',
    prompt: 'double colon test',
    models: ['gpt-4', 'gpt-4o-mini'],
    verbose: '1'
  },
  {
    description: 'slash command prompt fallback',
    requestModel: 'claude-script',
    defaultModel: 'gpt-4o-mini',
    responseText: 'fallback-response-10',
    prompt: 'run tests quickly',
    models: ['gpt-4o-mini', 'gpt-4o'],
    verbose: '2'
  },
  {
    description: 'long prompt fallback to gpt-4',
    requestModel: 'claude-app',
    defaultModel: 'gpt-4',
    responseText: 'fallback-response-11',
    prompt: 'explain fallback behaviour in detail',
    models: ['gpt-4', 'gpt-4o-mini', 'gpt-3.5-turbo'],
    verbose: '3'
  },
  {
    description: 'prefetch ensures fallback to gpt-4o',
    requestModel: 'claude-standalone',
    defaultModel: 'gpt-4o',
    responseText: 'fallback-response-12',
    prompt: 'prefetch check',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4'],
    verbose: '2'
  },
  {
    description: 'caps prompt fallback to gpt-4o-mini',
    requestModel: 'claude-high',
    defaultModel: 'gpt-4o-mini',
    responseText: 'fallback-response-13',
    prompt: 'HELP NOW',
    models: ['gpt-4o-mini', 'gpt-4'],
    verbose: '2'
  },
  {
    description: 'numbers prompt fallback to gpt-4',
    requestModel: 'claude-numeric',
    defaultModel: 'gpt-4',
    responseText: 'fallback-response-14',
    prompt: '12345',
    models: ['gpt-4', 'gpt-4o'],
    verbose: '2'
  },
  {
    description: 'emoji prompt fallback to gpt-4.1-mini',
    requestModel: 'claude-emoji',
    defaultModel: 'gpt-4.1-mini',
    responseText: 'fallback-response-15',
    prompt: '🔥 status',
    models: ['gpt-4.1-mini', 'gpt-4o-mini'],
    verbose: '3'
  },
  {
    description: 'dash prompt fallback to gpt-4',
    requestModel: 'claude-dash',
    defaultModel: 'gpt-4',
    responseText: 'fallback-response-16',
    prompt: 'force flag',
    models: ['gpt-4', 'gpt-4o'],
    verbose: '2'
  },
  {
    description: 'multi word prompt fallback to gpt-4o',
    requestModel: 'claude-longform',
    defaultModel: 'gpt-4o',
    responseText: 'fallback-response-17',
    prompt: 'summarize large documents quickly',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4'],
    verbose: '3'
  },
  {
    description: 'quote prompt fallback to gpt-4o-mini',
    requestModel: 'claude-quote',
    defaultModel: 'gpt-4o-mini',
    responseText: 'fallback-response-18',
    prompt: '"quoted text"',
    models: ['gpt-4o-mini', 'gpt-4o'],
    verbose: '2'
  },
  {
    description: 'unicode prompt fallback to gpt-4',
    requestModel: 'claude-unicode',
    defaultModel: 'gpt-4',
    responseText: 'fallback-response-19',
    prompt: '測試',
    models: ['gpt-4', 'gpt-4o-mini'],
    verbose: '2'
  },
  {
    description: 'json prompt fallback to gpt-4o',
    requestModel: 'claude-json',
    defaultModel: 'gpt-4o',
    responseText: 'fallback-response-20',
    prompt: '{"key":"value"}',
    models: ['gpt-4o', 'gpt-4o-mini'],
    verbose: '3'
  }
];

fallbackScenarios.forEach((scenario, index) => {
  test(`fallback scenario ${index + 1}: ${scenario.description}`, async (t) => {
    const context = await createTestContext(t, { models: scenario.models });
    const stubPath = await writeClaudeStub(context, CLAUDE_MULTI_STUB);

    if (scenario.defaultModel !== 'gpt-4') {
      const setResult = await runCopilot(context, ['profile', 'set', 'model.default', scenario.defaultModel]);
      assert.strictEqual(setResult.exitCode, 0, `profile set failed: ${setResult.stderr}`);
    }

    await fs.rm(context.mockLog, { force: true });

    const result = await runCopilot(
      context,
      ['exec', '--verbose', scenario.verbose, stubPath, '-p', scenario.prompt],
      { env: { CLAUDE_TEST_MODEL: scenario.requestModel }, mockResponseText: scenario.responseText }
    );
    assert.strictEqual(result.exitCode, 0, `stderr: ${result.stderr}`);
  // (debug prints removed)

    const payload = extractJsonPayload(result.stdout);
    assert.strictEqual(readResponseText(payload), scenario.responseText);

    const events = await readMockEvents(context);
    assert.ok(events.some((event) => event.event === 'list-models'), 'should fetch models');
    assertChatModel(events, scenario.defaultModel);

    const catalog = await readModelCatalog(context);
    assert.ok(catalog, 'model catalog should exist');
  });
});

const configScenarios = [
  { description: 'single update to gpt-4o-mini persists', sequence: ['gpt-4o-mini'], expected: 'gpt-4o-mini', runs: 2 },
  { description: 'toggle to gpt-4o then gpt-4', sequence: ['gpt-4o', 'gpt-4'], expected: 'gpt-4', runs: 1 },
  { description: 'switch between three models ending on gpt-4o', sequence: ['gpt-4', 'gpt-4o-mini', 'gpt-4o'], expected: 'gpt-4o', runs: 2 },
  { description: 'set gpt-4.1-mini as default', sequence: ['gpt-4.1-mini'], expected: 'gpt-4.1-mini', runs: 1 },
  { description: 'double set same model preserved', sequence: ['gpt-4', 'gpt-4'], expected: 'gpt-4', runs: 1 },
  { description: 'roundtrip mini to full back to mini', sequence: ['gpt-4o-mini', 'gpt-4o', 'gpt-4o-mini'], expected: 'gpt-4o-mini', runs: 2 },
  { description: 'set experimental model name', sequence: ['gpt-4o-audio-preview'], expected: 'gpt-4o-audio-preview', runs: 1 },
  { description: 'toggle four times ending on gpt-4', sequence: ['gpt-4o-mini', 'gpt-4o', 'gpt-4o-mini', 'gpt-4'], expected: 'gpt-4', runs: 2 },
  { description: 'set gpt-4.1 then gpt-4.1-mini', sequence: ['gpt-4.1', 'gpt-4.1-mini'], expected: 'gpt-4.1-mini', runs: 1 },
  { description: 'set gpt-4o-mini repeatedly to confirm idempotent', sequence: ['gpt-4o-mini', 'gpt-4o-mini', 'gpt-4o-mini'], expected: 'gpt-4o-mini', runs: 1 },
  { description: 'set gpt-4 then gpt-4.1', sequence: ['gpt-4', 'gpt-4.1'], expected: 'gpt-4.1', runs: 2 },
  { description: 'set gpt-4.1-mini then gpt-4o-mini', sequence: ['gpt-4.1-mini', 'gpt-4o-mini'], expected: 'gpt-4o-mini', runs: 1 },
  { description: 'set gpt-4o then fallback to gpt-4o-mini for persistence', sequence: ['gpt-4o', 'gpt-4o-mini'], expected: 'gpt-4o-mini', runs: 2 },
  { description: 'mix of values ending on gpt-4', sequence: ['gpt-4o', 'gpt-4.1-mini', 'gpt-4'], expected: 'gpt-4', runs: 1 },
  { description: 'set to gpt-4.1-mini twice with extra run', sequence: ['gpt-4.1-mini', 'gpt-4.1-mini'], expected: 'gpt-4.1-mini', runs: 2 }
];

configScenarios.forEach((scenario, index) => {
  test(`config persistence scenario ${index + 1}: ${scenario.description}`, async (t) => {
    const context = await createTestContext(t, { models: ['gpt-4', 'gpt-4o', 'gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-audio-preview'] });
    const stubPath = await writeClaudeStub(context, CLAUDE_MULTI_STUB);

    for (const model of scenario.sequence) {
      const setResult = await runCopilot(context, ['profile', 'set', 'model.default', model]);
      assert.strictEqual(setResult.exitCode, 0, `profile set failed: ${setResult.stderr}`);
    }

    await fs.rm(context.mockLog, { force: true });

    const runs = Math.max(1, scenario.runs ?? 1);
    for (let i = 0; i < runs; i += 1) {
      const execResult = await runCopilot(
        context,
        ['exec', '--verbose', '2', stubPath, '-p', `persist run ${i}`],
        { env: { CLAUDE_TEST_MODEL: 'claude-unknown' }, mockResponseText: `persist-response-${index}-${i}` }
      );
      assert.strictEqual(execResult.exitCode, 0, `stderr: ${execResult.stderr}`);
      const payload = extractJsonPayload(execResult.stdout);
      assert.strictEqual(readResponseText(payload), `persist-response-${index}-${i}`);
      const events = await readMockEvents(context);
      assertChatModel(events, scenario.expected);
      await fs.rm(context.mockLog, { force: true });
    }

    const configFile = path.join(context.configDir, 'config.json');
    const configText = await readFileIfExists(configFile);
    if (scenario.expected === 'gpt-4') {
      assert.ok(
        !configText || configText.includes('gpt-4'),
        'config should reflect default gpt-4 when no override is stored'
      );
    } else {
      assert.ok(configText && configText.includes(scenario.expected), 'config file should contain expected model');
    }
  });
});

const parameterScenarios = [
  {
    description: 'sentinel inserted for double dash prompt',
    cliArgs: ['exec', '--verbose', '2', 'claude', '-p', '--help'],
    expectedArgv: ['-p', '--', '--help'],
    expectedVerbose: '2',
    expectedProvider: 'anthropic'
  },
  {
    description: 'explicit double dash preserved',
    cliArgs: ['exec', '--verbose', '1', 'claude', '-p', '--', '--literal'],
    expectedArgv: ['-p', '--', '--literal'],
    expectedVerbose: '1',
    expectedProvider: 'anthropic'
  },
  {
    description: 'custom prompt with spaces',
    cliArgs: ['exec', '--verbose', '3', 'claude', '-p', 'feature flag status'],
    expectedArgv: ['-p', 'feature flag status'],
    expectedVerbose: '3',
    expectedProvider: 'anthropic'
  },
  {
    description: 'provider override to openai',
    cliArgs: ['exec', '--provider', 'openai', '--verbose', '2', 'claude', '-p', '--metrics'],
    expectedArgv: ['-p', '--', '--metrics'],
    expectedVerbose: '2',
    expectedProvider: 'openai'
  },
  {
    description: 'verbose zero disables logs',
    cliArgs: ['exec', '--verbose', '0', 'claude', '-p', '--version'],
    expectedArgv: ['-p', '--', '--version'],
    expectedVerbose: '0',
    expectedProvider: 'anthropic'
  },
  {
    description: 'high verbose level keeps log path',
    cliArgs: ['exec', '--verbose', '3', 'claude', '-p', '--debug'],
    expectedArgv: ['-p', '--', '--debug'],
    expectedVerbose: '3',
    expectedProvider: 'anthropic'
  },
  {
    description: 'additional positional arguments pass through',
    cliArgs: ['exec', '--verbose', '2', 'claude', '--dry-run', '-p', '::status'],
    expectedArgv: ['--dry-run', '-p', '::status'],
    expectedVerbose: '2',
    expectedProvider: 'anthropic'
  },
  {
    description: 'flag-style prompt',
    cliArgs: ['exec', '--verbose', '1', 'claude', '-p', '-V'],
    expectedArgv: ['-p', '--', '-V'],
    expectedVerbose: '1',
    expectedProvider: 'anthropic'
  },
  {
    description: 'long prompt with equals',
    cliArgs: ['exec', '--verbose', '2', 'claude', '-p', 'name=value'],
    expectedArgv: ['-p', 'name=value'],
    expectedVerbose: '2',
    expectedProvider: 'anthropic'
  },
  {
    description: 'prompt beginning with spaces',
    cliArgs: ['exec', '--verbose', '2', 'claude', '-p', '  spaced'],
    expectedArgv: ['-p', '  spaced'],
    expectedVerbose: '2',
    expectedProvider: 'anthropic'
  },
  {
    description: 'prompt with emoji',
    cliArgs: ['exec', '--verbose', '2', 'claude', '-p', '::👍'],
    expectedArgv: ['-p', '::👍'],
    expectedVerbose: '2',
    expectedProvider: 'anthropic'
  },
  {
    description: 'prompt containing quotes',
    cliArgs: ['exec', '--verbose', '2', 'claude', '-p', '\"quoted\"'],
    expectedArgv: ['-p', '\"quoted\"'],
    expectedVerbose: '2',
    expectedProvider: 'anthropic'
  },
  {
    description: 'no verbose flag uses inherited value',
    cliArgs: ['exec', 'claude', '-p', '--check'],
    expectedArgv: ['-p', '--', '--check'],
    expectedVerbose: undefined,
    expectedProvider: 'anthropic'
  },
  {
    description: 'provider override with extra args',
    cliArgs: ['exec', '--provider', 'openai', 'claude', '--foo', 'bar', '-p', '--openai'],
    expectedArgv: ['--foo', 'bar', '-p', '--', '--openai'],
    expectedVerbose: undefined,
    expectedProvider: 'openai'
  },
  {
    description: 'double dash inside prompt string',
    cliArgs: ['exec', '--verbose', '2', 'claude', '-p', 'value --flag'],
    expectedArgv: ['-p', 'value --flag'],
    expectedVerbose: '2',
    expectedProvider: 'anthropic'
  }
];

parameterScenarios.forEach((scenario, index) => {
  test(`parameter scenario ${index + 1}: ${scenario.description}`, async (t) => {
    const context = await createTestContext(t, { models: ['gpt-4', 'gpt-4o-mini', 'gpt-4o'] });
    const stubPath = await writeClaudeStub(context, CLAUDE_MULTI_STUB);

    const adjustedArgs = [...scenario.cliArgs];
    const targetIndex = adjustedArgs.findIndex((value, idx) => idx >= 1 && value === 'claude');
    assert.notStrictEqual(targetIndex, -1, 'scenario must include claude target');
    adjustedArgs[targetIndex] = stubPath;

    const result = await runCopilot(
      context,
      adjustedArgs,
      {
        env: {
          CLAUDE_STUB_MODE: 'inspect',
          CLAUDE_TEST_MODEL: 'claude-unknown'
        },
        mockResponseText: 'inspect-response'
      }
    );

    assert.strictEqual(result.exitCode, 0, `stderr: ${result.stderr}`);
    const payload = extractJsonPayload(result.stdout);
    assert.deepStrictEqual(payload.argv, scenario.expectedArgv);
    if (scenario.expectedVerbose !== undefined) {
      assert.strictEqual(payload.env.COPILOT_VERBOSE, scenario.expectedVerbose);
    }
    assert.strictEqual(payload.env.COPILOT_EXEC_PROVIDER, scenario.expectedProvider);
  });
});
