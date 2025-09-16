#!/usr/bin/env node

import yargs, { type Argv } from 'yargs';
import * as authCommands from './commands/auth.js';
import * as apiCommands from './commands/api.js';
import * as mcpCommands from './commands/mcp.js';
import * as configCommands from './commands/config.js';
import * as statusCommand from './commands/status.js';
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

function exitUsage(message: string): never {
  console.error(message);
  process.exit(2);
}

function commonServiceOptions(y: Argv) {
  return y
    .option('port', {
      alias: 'p',
      type: 'number',
      description: 'Port to bind'
    })
    .option('host', {
      alias: 'H',
      type: 'string',
      description: 'Host to bind'
    })
    .option('background', {
      alias: 'b',
      type: 'boolean',
      description: 'Run in background'
    })
    .option('debug', {
      alias: 'd',
      type: 'boolean',
      description: 'Enable debug logging'
    });
}

function withGlobalOptions(y: Argv) {
  return y
    .option('json', {
      type: 'boolean',
      description: 'Output JSON where supported'
    })
    .option('verbose', {
      type: 'boolean',
      description: 'Verbose output'
    })
    .strict()
    .fail((msg: string, err: any, _yargs: any) => {
      if (err) {
        console.error(err.message || err);
      } else if (msg) {
        console.error(msg);
      }
      process.exit(2);
    });
}
 
let parser = yargs(argv)
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
          .command('discover', 'Search GitHub for code using device flow and extract client_ids', (y: Argv) =>
            y
              .option('token', { type: 'string', describe: 'GitHub token (or set GITHUB_TOKEN env var)' })
              .option('query', { type: 'string', describe: 'Custom search query', default: '"github.com/login/device/code" client_id in:file' })
              .option('limit', { type: 'number', describe: 'Max results to fetch (approximate)', default: 150 })
              .option('output', { type: 'string', describe: 'Write CSV to file instead of stdout' })
          , async (args: any) => {
            await authCommands.discover({ token: args.token as string | undefined, query: args.query as string | undefined, limit: args.limit as number | undefined, output: args.output as string | undefined });
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
      'api <subcommand>',
      'Manage OpenAI-compatible API server',
      (y: Argv) =>
        y
          .command('start', 'Start the API server', (y: Argv) =>
            commonServiceOptions(y).option('token', { type: 'string', describe: 'Override auth token' })
          , async (args: any) => {
            await apiCommands.start({ port: args.port as number | undefined, host: args.host as string | undefined, token: args.token as string | undefined, background: !!args.background, debug: !!args.debug });
          })
          .command('stop', 'Stop the API server', () => {}, () => {
            apiCommands.stop();
          })
          .command('restart', 'Restart the API server', (y: Argv) =>
            commonServiceOptions(y).option('token', { type: 'string', describe: 'Override auth token' })
          , async (args: any) => {
            await apiCommands.restart({ port: args.port as number | undefined, host: args.host as string | undefined, token: args.token as string | undefined, background: !!args.background, debug: !!args.debug });
          })
          .command('status', 'Show API server status', (y: Argv) => y, (args: any) => {
            apiCommands.status({ json: !!args.json, verbose: !!args.verbose });
          })
          .demandCommand(1, 'Specify an api subcommand.')
      , () => {})
    .command(
      'mcp <subcommand>',
      'Manage MCP server',
      (y: Argv) =>
        y
          .command('start', 'Start the MCP server', (y: Argv) =>
            commonServiceOptions(y)
              .option('transport', { type: 'string', choices: ['stdio', 'tcp', 'sse'] as const, default: 'stdio', describe: 'Transport type' })
          , async (args: any) => {
            await mcpCommands.start({ transport: args.transport as any, port: args.port as number | undefined, background: !!args.background, debug: !!args.debug });
          })
          .command('stop', 'Stop the MCP server', () => {}, () => {
            mcpCommands.stop();
          })
          .command('restart', 'Restart the MCP server', (y: Argv) =>
            commonServiceOptions(y)
              .option('transport', { type: 'string', choices: ['stdio', 'tcp', 'sse'] as const, default: 'stdio', describe: 'Transport type' })
          , async (args: any) => {
            await mcpCommands.restart({ transport: args.transport as any, port: args.port as number | undefined, background: !!args.background, debug: !!args.debug });
          })
          .command('status', 'Show MCP server status', (y: Argv) => y, (args: any) => {
            mcpCommands.status({ json: !!args.json, verbose: !!args.verbose });
          })
          .demandCommand(1, 'Specify an mcp subcommand.')
      , () => {})
    .command(
      'config <subcommand>',
      'Manage copilot-cli configuration',
      (y: Argv) =>
        y
          .command('get <key>', 'Get configuration value', (y: Argv) => y.positional('key', { type: 'string' }), (args: any) => {
            if (!args.key) return exitUsage('Key required for config get');
            configCommands.get(args.key as string);
          })
          .command('set <key> <value>', 'Set configuration value', (y: Argv) => y.positional('key', { type: 'string' }).positional('value', { type: 'string' }), (args: any) => {
            if (!args.key || !args.value) return exitUsage('Key and value required for config set');
            configCommands.set(args.key as string, args.value as string);
          })
          .command('list', 'Show all configuration', () => {}, () => {
            configCommands.list();
          })
          .command('reset', 'Reset to defaults', () => {}, () => {
            configCommands.reset();
          })
          .demandCommand(1, 'Specify a config subcommand.')
      , () => {})
    .command(
      'status',
      'Show status of running services',
      (y: Argv) => y,
      (args: any) => {
        statusCommand.status({ json: !!args.json, verbose: !!args.verbose });
      }
    )
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
    // Aliases: verb-first service control
    .command(
      'service <verb> <target>',
      'Control services (alias for api/mcp commands)',
      (y: Argv) => commonServiceOptions(y)
        .positional('verb', { choices: ['start', 'stop', 'restart', 'status'] as const, type: 'string' })
        .positional('target', { choices: ['api', 'mcp'] as const, type: 'string' })
        .option('token', { type: 'string', describe: 'Override auth token (api only)' })
        .option('transport', { type: 'string', choices: ['stdio', 'tcp', 'sse'] as const, describe: 'Transport (mcp only)' })
  .middleware((args: any) => { /* no-op for now */ })
      , async (args: any) => {
        const verb = args.verb as 'start' | 'stop' | 'restart' | 'status';
        const target = args.target as 'api' | 'mcp';
        if (target === 'api') {
          if (verb === 'start') return apiCommands.start({ port: args.port as number | undefined, host: args.host as string | undefined, token: args.token as string | undefined, background: !!args.background, debug: !!args.debug });
          if (verb === 'stop') return apiCommands.stop();
          if (verb === 'restart') return apiCommands.restart({ port: args.port as number | undefined, host: args.host as string | undefined, token: args.token as string | undefined, background: !!args.background, debug: !!args.debug });
          if (verb === 'status') return apiCommands.status({ json: !!args.json, verbose: !!args.verbose });
        } else if (target === 'mcp') {
          if (verb === 'start') return mcpCommands.start({ transport: args.transport as any, port: args.port as number | undefined, background: !!args.background, debug: !!args.debug });
          if (verb === 'stop') return mcpCommands.stop();
          if (verb === 'restart') return mcpCommands.restart({ transport: args.transport as any, port: args.port as number | undefined, background: !!args.background, debug: !!args.debug });
          if (verb === 'status') return mcpCommands.status({ json: !!args.json, verbose: !!args.verbose });
        }
      }
    )
    // Shell completion support
    .completion('completion', false);

// Configure version before applying global options to keep types consistent
parser = pkgVersion ? parser.version(pkgVersion) : parser.version();
parser = parser.alias('version', 'v');

parser = withGlobalOptions(parser);

await parser.parseAsync();