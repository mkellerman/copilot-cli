#!/usr/bin/env node

import yargs, { type Argv } from 'yargs';

import { ConfigManager } from '../core/config-manager.js';
import { ModelCatalog } from '../core/model-catalog.js';
import { runApiCommand } from './commands/api.js';
import { runChatCommand } from './commands/chat.js';
import { runExecCommand } from './commands/exec.js';
import * as profileCommands from './commands/profile/index.js';
import * as devCommands from './commands/dev/index.js';
import { requireActiveProfile, getProvider } from './commands/profile/shared.js';

// Global legacy notice tracking - must be declared early to avoid hoisting issues
const legacyNotices = new Set<string>();

function warnLegacyUsage(message: string): void {
  if (legacyNotices.has(message)) return;
  legacyNotices.add(message);
  console.warn(`[deprecated] ${message}`);
}

const argv = process.argv.slice(2);

let pkgVersion: string | undefined;
try {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const pkgPath = resolve(__dirname, '../../package.json');
  const packageJson = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkgVersion = packageJson.version as string | undefined;
} catch {
  // ignore
}

function clampVerbose(value: number): number {
  if (value < 0) return 0;
  if (value > 3) return 3;
  return Math.floor(value);
}

function normalizeVerbose(value: unknown): number | undefined {
  if (typeof value !== 'number') {
    return undefined;
  }
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return clampVerbose(value);
}

function handleCommandError(error: unknown): never {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }
  process.exit(1);
}

let parser: Argv = yargs(argv)
  .scriptName('copilot')
  .usage('Usage: $0 <command> [options]')
  .wrap(Math.min(100, process.stdout.columns || 100))
  .demandCommand(1, 'Specify a command. See --help for usage.')
  .help('help')
  .alias('help', 'h')
  .updateStrings({
    'boolean': '',
    'string': '',
    'number': '',
    'array': '',
    'count': ''
  })
  .strict()
  .fail((msg: string, err: any, yargsInstance: Argv) => {
    if (err) {
      console.error(err.message || err);
    } else if (msg) {
      console.error(msg);
    }
    try {
      yargsInstance?.showHelp();
    } catch {
      // ignore
    }
    process.exit(2);
  })
  .option('json', {
    type: 'boolean',
    description: 'Output JSON where supported',
    global: true
  })
  .option('verbose', {
    type: 'number',
    description: 'Verbose output level (0-3)',
    global: true,
    coerce: (value) => {
      const normalized = normalizeVerbose(value);
      return normalized;
    }
  })
  .middleware((args) => {
    const verbose = normalizeVerbose(args.verbose);
    if (typeof verbose === 'number') {
      args.verbose = verbose;
      process.env.COPILOT_VERBOSE = String(verbose);
    }
  }, true)
  .command(
    'api',
    'Run the local OpenAI-compatible proxy',
    (y: Argv) =>
      y
        .option('port', {
          alias: 'p',
          type: 'number',
          description: 'Port to bind'
        })
        .option('token', {
          type: 'string',
          description: 'Override Copilot token'
        })
        .option('silent', {
          type: 'boolean',
          description: 'Suppress startup banner'
        }),
    async (args: any) => {
      try {
        await runApiCommand({
          port: args.port as number | undefined,
          token: args.token as string | undefined,
          silent: args.silent as boolean | undefined
        });
      } catch (error) {
        handleCommandError(error);
      }
    }
  )
  .command(
    'chat <prompt...>',
    'Send a single prompt to Copilot',
    (y: Argv) => y.positional('prompt', { array: true, type: 'string' }),
    async (args: any) => {
      const promptParts = Array.isArray(args.prompt) ? (args.prompt as string[]) : [];
      const prompt = promptParts.join(' ').trim();
      if (!prompt) {
        handleCommandError('Specify a prompt. Example: copilot chat "Explain monads briefly"');
      }
      try {
        await runChatCommand(prompt);
      } catch (error) {
        handleCommandError(error);
      }
    }
  )
  .command(
    'profile <subcommand>',
    'Manage authentication, configuration, and models',
    (y: Argv) =>
      y
        .command(
          'login',
          'Authenticate via device flow',
          (yy: Argv) =>
            yy.option('provider', {
              type: 'string',
              describe: 'Auth provider id'
            }),
          async (args: any) => {
            try {
              await profileCommands.login(args.provider as string | undefined);
            } catch (error) {
              handleCommandError(error);
            }
          }
        )
        .command(
          'logout [id]',
          'Remove a profile or the active one',
          (yy: Argv) => yy,
          (args: any) => {
            try {
              profileCommands.logout(args.id as string | undefined);
            } catch (error) {
              handleCommandError(error);
            }
          }
        )
        .command(
          'status',
          'Show current authentication and model status',
          (yy: Argv) => yy,
          async (args: any) => {
            try {
              await profileCommands.status({ json: !!args.json });
            } catch (error) {
              handleCommandError(error);
            }
          }
        )
        .command(
          'list',
          'List all profiles',
          (yy: Argv) => yy,
          () => {
            try {
              profileCommands.list();
            } catch (error) {
              handleCommandError(error);
            }
          }
        )
        .command(
          'switch <id>',
          'Switch active profile',
          (yy: Argv) => yy.positional('id', { type: 'string' }),
          (args: any) => {
            try {
              profileCommands.switchProfile(args.id as string);
            } catch (error) {
              handleCommandError(error);
            }
          }
        )
        .command(
          'set <key> <value>',
          'Update configuration value (e.g. model.default)',
          (yy: Argv) =>
            yy
              .positional('key', { type: 'string' })
              .positional('value', { type: 'string' }),
          async (args: any) => {
            try {
              await profileCommands.set(args.key as string, args.value as string);
            } catch (error) {
              handleCommandError(error);
            }
          }
        )
        .command(
          'get <key>',
          'Print configuration value',
          (yy: Argv) => yy.positional('key', { type: 'string' }),
          async (args: any) => {
            try {
              await profileCommands.get(args.key as string);
            } catch (error) {
              handleCommandError(error);
            }
          }
        )
        .command(
          'refresh',
          'Refresh tokens and model cache',
          (yy: Argv) => yy,
          async () => {
            try {
              await profileCommands.refresh();
            } catch (error) {
              handleCommandError(error);
            }
          }
        )
        .demandCommand(1, 'Specify a profile subcommand.')
        .help(false)
        .version(false),
    () => {}
  )
  .command(
    {
      command: 'dev <subcommand>',
      describe: false,
      builder: (y: Argv) =>
        y
          .command(
            'mcp',
            'Run the MCP server over stdio',
            (yy: Argv) =>
              yy.option('debug', {
                type: 'boolean',
                describe: 'Enable debug logging'
              }),
            async (args: any) => {
              try {
                await devCommands.mcp({
                  debug: !!args.debug,
                  version: pkgVersion
                });
              } catch (error) {
                handleCommandError(error);
              }
            }
          )
          .command(
            'doctor',
            'Validate effective configuration and environment',
            (yy: Argv) => yy,
            async () => {
              try {
                await devCommands.doctor();
              } catch (error) {
                handleCommandError(error);
              }
            }
          )
          .command(
            'transforms <action> [value]',
            'Manage request transformers (experimental)',
            (yy: Argv) =>
              yy
                .positional('action', {
                  type: 'string',
                  choices: ['status', 'enable', 'disable', 'allow-scripts'] as const
                })
                .positional('value', {
                  type: 'string',
                  describe: 'Value for allow-scripts'
                }),
            async (args: any) => {
              const action = args.action as string;
              try {
                switch (action) {
                  case 'status':
                    await devCommands.transformsStatus();
                    break;
                  case 'enable':
                    await devCommands.setTransformsEnabled(true);
                    break;
                  case 'disable':
                    await devCommands.setTransformsEnabled(false);
                    break;
                  case 'allow-scripts':
                    await devCommands.setTransformsAllowScripts(parseBooleanArg(args.value));
                    break;
                  default:
                    handleCommandError(`Unknown transforms action: ${action}`);
                }
              } catch (error) {
                handleCommandError(error);
              }
            }
          )
          .demandCommand(1, 'Specify a dev subcommand.')
          .help(false)
          .version(false),
      handler: () => {}
    }
  )
  .command(
    {
      command: 'exec <target> [extras...]',
      describe: 'Execute a tool with Copilot environment injection',
      builder: (y: Argv) =>
        y
          .positional('target', {
            type: 'string',
            describe: 'Executable to run'
          })
          .positional('extras', {
            type: 'string',
            array: true,
            default: []
          })
          .option('provider', {
            choices: ['anthropic', 'openai'] as const,
            description: 'Force provider semantics for environment injection'
          })
          .parserConfiguration({
            'unknown-options-as-args': true,
            'populate--': true
          })
          .help(false)
          .version(false)
          .strict(false),
      handler: async (args: any) => {
        const passThrough = collectExecArgs(args);
        const provider = args.provider as 'anthropic' | 'openai' | undefined;
        try {
          await runExecCommand({
            command: args.target as string,
            args: passThrough,
            provider,
            globalVerbose: typeof args.verbose === 'number' ? (args.verbose as number) : undefined
          });
        } catch (error) {
          handleCommandError(error);
        }
      }
    }
  )
  .command(
    {
      command: 'auth <subcommand>',
      describe: false,
      builder: (y: Argv) =>
        y
          .command(
            'login',
            false,
            (yy: Argv) =>
              yy.option('provider', {
                type: 'string'
              }),
            async (args: any) => {
              warnLegacyUsage('"copilot auth" is deprecated; use "copilot profile".');
              try {
                await profileCommands.login(args.provider as string | undefined);
              } catch (error) {
                handleCommandError(error);
              }
            }
          )
          .command(
            'logout [id]',
            false,
            (yy: Argv) => yy,
            (args: any) => {
              warnLegacyUsage('"copilot auth" is deprecated; use "copilot profile".');
              profileCommands.logout(args.id as string | undefined);
            }
          )
          .command(
            'status',
            false,
            (yy: Argv) => yy,
            async (args: any) => {
              warnLegacyUsage('"copilot auth" is deprecated; use "copilot profile".');
              try {
                await profileCommands.status({ json: !!args.json });
              } catch (error) {
                handleCommandError(error);
              }
            }
          )
          .command(
            'list',
            false,
            (yy: Argv) => yy,
            () => {
              warnLegacyUsage('"copilot auth" is deprecated; use "copilot profile".');
              profileCommands.list();
            }
          )
          .command(
            'switch <id>',
            false,
            (yy: Argv) => yy.positional('id', { type: 'string' }),
            (args: any) => {
              warnLegacyUsage('"copilot auth" is deprecated; use "copilot profile".');
              profileCommands.switchProfile(args.id as string);
            }
          )
          .command(
            'refresh',
            false,
            (yy: Argv) => yy,
            async () => {
              warnLegacyUsage('"copilot auth" is deprecated; use "copilot profile".');
              try {
                await profileCommands.refresh();
              } catch (error) {
                handleCommandError(error);
              }
            }
          )
          .command(
            'inventory',
            false,
            (yy: Argv) => yy,
            () => {
              warnLegacyUsage('The "copilot auth inventory" command has been removed.');
              console.error('Use provider-specific tooling to inventory models.');
              process.exit(1);
            }
          )
          .demandCommand(1, 'Specify a legacy auth subcommand.')
          .help(false)
          .version(false)
          .strict(false),
      handler: () => {}
    }
  )
  .command(
    {
      command: 'config <subcommand>',
      describe: false,
      builder: (y: Argv) =>
        y
          .command(
            'get <key>',
            false,
            (yy: Argv) => yy.positional('key', { type: 'string' }),
            async (args: any) => {
              warnLegacyUsage('"copilot config" is deprecated; use "copilot profile get/set".');
              try {
                await profileCommands.get(args.key as string);
              } catch (error) {
                handleCommandError(error);
              }
            }
          )
          .command(
            'set <key> <value>',
            false,
            (yy: Argv) =>
              yy
                .positional('key', { type: 'string' })
                .positional('value', { type: 'string' }),
            async (args: any) => {
              warnLegacyUsage('"copilot config" is deprecated; use "copilot profile set".');
              try {
                await profileCommands.set(args.key as string, args.value as string);
              } catch (error) {
                handleCommandError(error);
              }
            }
          )
          .command(
            'list',
            false,
            (yy: Argv) => yy,
            () => {
              warnLegacyUsage('"copilot config" is deprecated; use "copilot profile" commands.');
              const cfg = ConfigManager.getInstance().list();
              console.log(JSON.stringify(cfg, null, 2));
            }
          )
          .command(
            'reset',
            false,
            (yy: Argv) => yy,
            async () => {
              warnLegacyUsage('"copilot config reset" is deprecated.');
              try {
                await ConfigManager.getInstance().reset();
                console.log('✓ Configuration reset to defaults');
              } catch (error) {
                handleCommandError(error);
              }
            }
          )
          .command(
            'doctor',
            false,
            (yy: Argv) => yy,
            async () => {
              warnLegacyUsage('"copilot config doctor" is now "copilot dev doctor".');
              try {
                await devCommands.doctor();
              } catch (error) {
                handleCommandError(error);
              }
            }
          )
          .demandCommand(1, 'Specify a legacy config subcommand.')
          .help(false)
          .version(false)
          .strict(false),
      handler: () => {}
    }
  )
  .command(
    {
      command: 'model <subcommand>',
      describe: false,
      builder: (y: Argv) =>
        y
          .command(
            'list',
            false,
            (yy: Argv) => yy,
            async () => {
              warnLegacyUsage('"copilot model" commands are deprecated; use "copilot profile" equivalents.');
              try {
                await legacyListModels();
              } catch (error) {
                handleCommandError(error);
              }
            }
          )
          .command(
            'refresh',
            false,
            (yy: Argv) => yy,
            async () => {
              warnLegacyUsage('"copilot model refresh" is now "copilot profile refresh".');
              try {
                await profileCommands.refresh();
              } catch (error) {
                handleCommandError(error);
              }
            }
          )
          .command(
            'set [model]',
            false,
            (yy: Argv) => yy.positional('model', { type: 'string' }),
            async (args: any) => {
              warnLegacyUsage('"copilot model set" is now "copilot profile set model.default <model>".');
              try {
                await legacySetDefaultModel(args.model as string | undefined);
              } catch (error) {
                handleCommandError(error);
              }
            }
          )
          .command(
            'info',
            false,
            (yy: Argv) => yy,
            async () => {
              warnLegacyUsage('"copilot model info" is deprecated; use "copilot profile status".');
              try {
                await legacyShowModelInfo();
              } catch (error) {
                handleCommandError(error);
              }
            }
          )
          .demandCommand(1, 'Specify a legacy model subcommand.')
          .help(false)
          .version(false)
          .strict(false),
      handler: () => {}
    }
  )
  .command(
    {
      command: 'claude [claudeArgs...]',
      describe: false,
      builder: (y: Argv) =>
        y
          .positional('claudeArgs', {
            type: 'string',
            array: true,
            default: []
          })
          .parserConfiguration({
            'unknown-options-as-args': true,
            'halt-at-non-option': true,
            'populate--': true
          })
          .help(false)
          .version(false)
          .strict(false),
      handler: async (args: any) => {
        warnLegacyUsage('"copilot claude" is deprecated; use "copilot exec claude".');
        const passThrough = collectLegacyExecArgs('claude');
        await runExecCommand({
          command: 'claude',
          args: passThrough,
          provider: 'anthropic',
          globalVerbose: typeof args.verbose === 'number' ? (args.verbose as number) : undefined
        });
      }
    }
  )
  .command(
    {
      command: 'happy [happyArgs...]',
      describe: false,
      builder: (y: Argv) =>
        y
          .positional('happyArgs', {
            type: 'string',
            array: true,
            default: []
          })
          .parserConfiguration({
            'unknown-options-as-args': true,
            'halt-at-non-option': true,
            'populate--': true
          })
          .help(false)
          .version(false)
          .strict(false),
      handler: async (args: any) => {
        warnLegacyUsage('"copilot happy" is deprecated; use "copilot exec happy".');
        const passThrough = collectLegacyExecArgs('happy');
        await runExecCommand({
          command: 'happy',
          args: passThrough,
          provider: 'anthropic',
          globalVerbose: typeof args.verbose === 'number' ? (args.verbose as number) : undefined
        });
      }
    }
  );

parser = pkgVersion ? parser.version(pkgVersion) : parser.version();
parser = parser.alias('version', 'v');

await parser.parseAsync();

function collectExecArgs(args: any): string[] {
  const extras = Array.isArray(args.extras) ? (args.extras as string[]) : [];
  const afterDoubleDash = Array.isArray(args['--']) ? (args['--'] as string[]) : [];
  const merged = [...extras, ...afterDoubleDash];
  return merged.filter((value) => value !== '--');
}

function parseBooleanArg(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') {
    throw new Error('Expected boolean value (true/false)');
  }
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  throw new Error('Expected boolean value (true/false)');
}

function collectLegacyExecArgs(commandName: string): string[] {
  const index = process.argv.findIndex((arg, idx) => idx >= 2 && arg === commandName);
  if (index === -1) {
    return [];
  }
  return process.argv.slice(index + 1).filter((value) => value !== '--');
}

async function legacyListModels(): Promise<void> {
  const { id, profile } = requireActiveProfile();
  const provider = getProvider(profile.provider);
  const catalog = ModelCatalog.getInstance();
  const config = ConfigManager.getInstance();
  const entry = catalog.getEntry(id);

  console.log(`\nUsing profile: ${id} (${profile.user.name || profile.user.login})`);
  console.log(`Provider: ${provider?.name || profile.provider}`);

  if (!entry) {
    console.log('\n✗ No cached model data. Run: copilot profile refresh');
    return;
  }

  const currentModel = config.get<string>('model.default') || entry.models[0] || 'gpt-4';

  console.log('\nWorking models:');
  console.log('===============\n');
  if (entry.models.length === 0) {
    console.log('  (none)');
  } else {
    entry.models.forEach((modelId) => {
      const marker = modelId === currentModel ? '  ▶ ' : '    ';
      console.log(`${marker}${modelId}`);
    });
  }

  console.log(`\nCurrent default: ${currentModel}`);
  if (entry.status === 'stale') {
    console.log('Cache status: ⚠ stale — refresh recommended');
  }
}

async function legacyShowModelInfo(): Promise<void> {
  const { id, profile } = requireActiveProfile();
  const catalog = ModelCatalog.getInstance();
  const config = ConfigManager.getInstance();
  const currentModel = config.get<string>('model.default') || 'gpt-4';
  const entry = catalog.getEntry(id);

  console.log('\nModel configuration');
  console.log('===================');
  console.log(`Default model: ${currentModel}`);

  if (!entry) {
    console.log('\nNo cached models found. Run: copilot profile refresh');
    return;
  }

  if (!entry.models.includes(currentModel)) {
    console.log(`\n⚠ ${currentModel} is not in the working model list.`);
  }

  console.log('\nCached working models:');
  entry.models.forEach((modelId) => {
    const marker = modelId === currentModel ? '  ▶ ' : '    ';
    console.log(`${marker}${modelId}`);
  });
}

async function legacySetDefaultModel(modelId?: string): Promise<void> {
  if (!modelId) {
    throw new Error('Specify a model id. Example: copilot profile set model.default gpt-4o-mini');
  }

  const { id } = requireActiveProfile();
  const catalog = ModelCatalog.getInstance();
  const entry = catalog.getEntry(id);
  if (entry && entry.models.length > 0 && !entry.models.includes(modelId)) {
    throw new Error(`Model '${modelId}' is not in the working model list. Available: ${entry.models.join(', ')}`);
  }

  await ConfigManager.getInstance().set('model.default', modelId);
  console.log(`✓ Default model set to: ${modelId}`);
}
