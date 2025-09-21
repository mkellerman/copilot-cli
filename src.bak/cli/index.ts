#!/usr/bin/env node

import yargs, { type Argv } from 'yargs';
import * as authCommands from './commands/auth.js';
import * as apiCommands from './commands/api.js';
import * as configCommands from './commands/config.js';
import * as mcpCommands from './commands/mcp.js';
import * as claudeCommand from './commands/claude.js';
import * as happyCommand from './commands/happy.js';
import * as chatCommand from './commands/chat.js';
import * as modelCommands from './commands/model.js';

const argv = process.argv.slice(2);

// Resolve package version for --version output
let pkgVersion: string | undefined;
try {
  const { readFileSync } = await import('fs');
  const { fileURLToPath } = await import('url');
  const { dirname, resolve } = await import('path');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const pkgPath = resolve(__dirname, '../../package.json');
  const packageJson = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkgVersion = packageJson.version as string | undefined;
} catch {
  // ignore; yargs will still show --version but without package linkage
}

let parser: Argv;

function exitUsage(message: string): never {
  console.error(message);
  try {
    parser?.showHelp();
  } catch {
    // ignore help rendering errors
  }
  process.exit(2);
}

function withGlobalOptions(y: Argv) {
  return y
    .option('json', {
      type: 'boolean',
      description: 'Output JSON where supported'
    })
    .option('verbose', {
      type: 'number',
      description: 'Verbose output level (0-3)',
      coerce: (v: any) => {
        const n = parseInt(v, 10);
        if (!Number.isFinite(n)) return undefined;
        if (n < 0) return 0;
        if (n > 3) return 3;
        return n;
      }
    })
    .strict()
    .fail((msg: string, err: any, yargsInstance: Argv) => {
      if (err) {
        console.error(err.message || err);
      } else if (msg) {
        const friendly = msg.includes('Not enough non-option arguments')
          ? 'Specify a subcommand. See --help for usage.'
          : msg;
        console.error(friendly);
      }
      try {
        yargsInstance?.showHelp();
      } catch {
        // ignore help rendering errors
      }
      process.exit(2);
    });
}
 
parser = yargs(argv)
  .scriptName('copilot-cli')
  .usage('Usage: $0 <command> [options]')
  .wrap(Math.min(100, process.stdout.columns || 100))
  .recommendCommands()
  .demandCommand(1, 'Specify a command. See --help for usage.')
  .help('help')
  .alias('help', 'h')
  .showHelpOnFail(true, 'Specify --help for available options')
  .updateStrings({
    'boolean': '',
    'string': '',
    'number': '',
    'array': '',
    'count': ''
  })
    .command(
      'auth <subcommand>',
      'Manage GitHub Copilot authentication',
  (y: Argv) =>
        y
          .command('login', 'Authenticate via device flow', (y: Argv) =>
            y.option('provider', { type: 'string', describe: 'Auth provider id' })
          , async (args: any) => {
            await authCommands.login(args.provider as string | undefined);
          })
          .command('inventory', 'Authenticate with multiple providers and list models as CSV', (y: Argv) =>
            y
              .option('providers', { type: 'string', describe: 'Comma-separated provider ids to try (defaults to all known)' })
              .option('output', { type: 'string', describe: 'Write CSV to file instead of stdout' })
          , async (args: any) => {
            await authCommands.inventory({ providers: args.providers as string | undefined, output: args.output as string | undefined });
          })
          .command('logout [id]', 'Remove authentication profile', () => {}, (args: any) => {
            authCommands.logout(args.id as string | undefined);
          })
          .command('list', 'List all authentication profiles', () => {}, async () => {
            await authCommands.list();
          })
          .command('switch <id>', 'Switch to a specific profile', (y: Argv) => y.positional('id', { type: 'string' }), (args: any) => {
            if (!args.id) return exitUsage('Profile ID required for auth switch');
            authCommands.switchProfile(args.id as string);
          })
          .command('status', 'Check current authentication status', (y: Argv) => y, async (args: any) => {
            await authCommands.status({ json: !!args.json, verbose: !!args.verbose });
          })
          .command('refresh', 'Refresh current authentication token', () => {}, async () => {
            await authCommands.refresh();
          })
          .demandCommand(1, 'Specify an auth subcommand.')
      , () => {})
    .command(
      'api',
      'Run the OpenAI-compatible API server',
      (y: Argv) =>
        y
          .option('port', {
            alias: 'p',
            type: 'number',
            description: 'Port to bind'
          })
          .option('token', {
            type: 'string',
            describe: 'Override authentication token'
          })
          .option('debug', {
            alias: 'd',
            type: 'boolean',
            description: 'Enable debug logging'
          })
          .option('verbose', {
            type: 'number',
            describe: 'Verbose output level (0-3)'
          })
          .option('silent', {
            type: 'boolean',
            description: 'Suppress startup banner output'
          })
      , async (args: any) => {
        if (typeof args.verbose === 'number') {
          process.env.COPILOT_VERBOSE = String(args.verbose);
        }
        await apiCommands.run({
          port: args.port as number | undefined,
          token: args.token as string | undefined,
          debug: !!args.debug,
          verbose: typeof args.verbose === 'number' ? args.verbose : undefined,
          silent: !!args.silent
        });
      })
    .command(
      'mcp',
      'Run the MCP server over stdio',
      (y: Argv) =>
        y.option('debug', {
          alias: 'd',
          type: 'boolean',
          description: 'Enable debug logging'
        }),
      async (args: any) => {
        await mcpCommands.run({
          debug: !!args.debug,
          version: pkgVersion
        });
      }
    )
    .command(
      'happy [happyArgs...]'
      , 'Expose Copilot as an Anthropic-compatible proxy and run the happy CLI'
      , (y: Argv) =>
        y
          .help(false)
          .version(false)
          .strict(false)
          .parserConfiguration({
            'unknown-options-as-args': true,
            'halt-at-non-option': true
          })
          .positional('happyArgs', {
            type: 'string',
            array: true,
            default: []
          })
      , async (_args: any) => {
        const rawArgv = process.argv;
        const commandIndex = rawArgv.findIndex((arg, idx) => idx >= 2 && arg === 'happy');
        const passThrough = commandIndex >= 0 ? rawArgv.slice(commandIndex + 1) : [];
        await happyCommand.run({}, passThrough);
      }
    )
    .command(
      'claude [claudeArgs...]'
      , 'Expose Copilot as an Anthropic-compatible proxy and run the Claude CLI'
      , (y: Argv) =>
        y
          .help(false)
          .version(false)
          .strict(false)
          .parserConfiguration({
            'unknown-options-as-args': true,
            'halt-at-non-option': true
          })
          .positional('claudeArgs', {
            type: 'string',
            array: true,
            default: []
          })
      , async (_args: any) => {
        const rawArgv = process.argv;
        const commandIndex = rawArgv.findIndex((arg, idx) => idx >= 2 && arg === 'claude');
        const passThrough = commandIndex >= 0 ? rawArgv.slice(commandIndex + 1) : [];
        await claudeCommand.run({}, passThrough);
      }
    )
    .command(
      'config <subcommand>',
      'Manage copilot-cli configuration',
      (y: Argv) =>
        y
          .command('get <key>', 'Get configuration value', (y: Argv) => y.positional('key', { type: 'string' }), (args: any) => {
            if (!args.key) return exitUsage('Key required for config get');
            return configCommands.get(args.key as string);
          })
          .command('set <key> <value>', 'Set configuration value', (y: Argv) => y.positional('key', { type: 'string' }).positional('value', { type: 'string' }), (args: any) => {
            if (!args.key || !args.value) return exitUsage('Key and value required for config set');
            return configCommands.set(args.key as string, args.value as string);
          })
          .command('list', 'Show all configuration', () => {}, () => {
            return configCommands.list();
          })
          .command('reset', 'Reset to defaults', () => {}, () => {
            return configCommands.reset();
          })
          .command('doctor', 'Validate configuration file and environment overrides', () => {}, () => {
            return configCommands.doctor();
          })
          .demandCommand(1, 'Specify a config subcommand.')
      , () => {})
    .command(
      'chat <prompt...>',
      'Send a prompt to GitHub Copilot',
      (y: Argv) => y.positional('prompt', { array: true, type: 'string' }),
      async (args: any) => {
        const prompt = (args.prompt as string[]).join(' ').trim();
        if (!prompt) return exitUsage('Usage: copilot-cli chat "<prompt>"');
        await chatCommand.chat(prompt);
      }
    )
    .command(
      'model <subcommand>',
      'Manage Copilot model selection',
      (y: Argv) =>
        y
          .command('list', 'List cached working models', () => {}, async () => {
            await modelCommands.list();
          })
          .command('refresh', 'Fetch and test all models, update cache', () => {}, async () => {
            await modelCommands.refresh();
          })
          .command('set [model]', 'Set default model (interactive if omitted)', (y: Argv) => y.positional('model', { type: 'string' }), async (args: any) => {
            await modelCommands.set(args.model as string | undefined);
          })
          .command('info', 'Show current model configuration', () => {}, async () => {
            await modelCommands.info();
          })
          .demandCommand(1, 'Specify a model subcommand.')
      , () => {})
    // Shell completion support
    .completion('completion', false);

// Configure version before applying global options to keep types consistent
parser = pkgVersion ? parser.version(pkgVersion) : parser.version();
parser = parser.alias('version', 'v');

parser = withGlobalOptions(parser);

await parser.parseAsync();
