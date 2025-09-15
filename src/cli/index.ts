#!/usr/bin/env node

import * as authCommands from './commands/auth.js';
import * as apiCommands from './commands/api.js';
import * as mcpCommands from './commands/mcp.js';
import * as configCommands from './commands/config.js';
import * as statusCommand from './commands/status.js';
import * as chatCommand from './commands/chat.js';
import * as modelCommands from './commands/model.js';
import { authHelp, apiHelp, mcpHelp, configHelp, statusHelp, modelHelp } from './help.js';

const args = process.argv.slice(2);
const command = args[0];
const subcommand = args[1];

const helpText = `
GitHub Copilot CLI

USAGE
  copilot-cli <command> [options]

COMMANDS
  auth            Manage GitHub Copilot authentication
  api             Manage OpenAI-compatible API server
  mcp             Manage MCP server
  config          Manage copilot-cli configuration
  status          Show status of running services
  chat            Send a prompt to GitHub Copilot
  model           Manage Copilot model selection

OPTIONS
  -h, --help      Show help for command
  -v, --version   Show version

EXAMPLES
  $ copilot-cli auth login
  $ copilot-cli api start
  $ copilot-cli mcp start
  $ copilot-cli status
  $ copilot-cli chat "What is TypeScript?"

LEARN MORE
  Use 'copilot-cli <command> --help' for more information about a command.
`;

function showVersion(): void {
  console.log('copilot-cli version 1.0.0');
}

function parseOptions(args: string[]): Record<string, any> {
  const options: Record<string, any> = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '-p' || arg === '--port') {
      options.port = parseInt(args[++i]);
    } else if (arg === '-H' || arg === '--host') {
      options.host = args[++i];
    } else if (arg === '--transport') {
      options.transport = args[++i];
    } else if (arg === '--token') {
      options.token = args[++i];
    } else if (arg === '--background') {
      options.background = true;
    } else if (arg === '--debug') {
      options.debug = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '-v' || arg === '--version') {
      options.version = true;
    }
  }
  
  return options;
}

async function main(): Promise<void> {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(helpText);
    process.exit(0);
  }
  
  if (command === '--version' || command === '-v') {
    showVersion();
    process.exit(0);
  }
  
  const options = parseOptions(args.slice(2));
  
  if (options.version) {
    showVersion();
    process.exit(0);
  }
  
  switch (command) {
    case 'auth':
      if (!subcommand || options.help) {
        console.log(authHelp);
        process.exit(0);
      }
      
      switch (subcommand) {
        case 'login':
          // Check for --provider flag
          let providerId: string | undefined;
          for (let i = 2; i < args.length; i++) {
            if (args[i] === '--provider' && args[i + 1]) {
              providerId = args[i + 1];
              break;
            }
          }
          await authCommands.login(providerId);
          break;
        case 'logout':
          const logoutProfileId = args[2]; // Optional profile ID
          authCommands.logout(logoutProfileId);
          break;
        case 'list':
          await authCommands.list();
          break;
        case 'switch':
          if (!args[2]) {
            console.error('Error: Profile ID required for auth switch');
            console.log('Usage: copilot-cli auth switch <profile-id>');
            process.exit(1);
          }
          authCommands.switchProfile(args[2]);
          break;
        case 'status':
          await authCommands.status();
          break;
        case 'refresh':
          await authCommands.refresh();
          break;
        default:
          console.error(`Unknown auth subcommand: ${subcommand}`);
          console.log('See: copilot-cli auth --help');
          process.exit(1);
      }
      break;
      
    case 'api':
      if (!subcommand || options.help) {
        console.log(apiHelp);
        process.exit(0);
      }
      
      switch (subcommand) {
        case 'start':
          await apiCommands.start(options);
          break;
        case 'stop':
          apiCommands.stop();
          break;
        case 'restart':
          await apiCommands.restart(options);
          break;
        case 'status':
          apiCommands.status();
          break;
        default:
          console.error(`Unknown api subcommand: ${subcommand}`);
          console.log('See: copilot-cli api --help');
          process.exit(1);
      }
      break;
      
    case 'mcp':
      if (!subcommand || options.help) {
        console.log(mcpHelp);
        process.exit(0);
      }
      
      switch (subcommand) {
        case 'start':
          await mcpCommands.start(options);
          break;
        case 'stop':
          mcpCommands.stop();
          break;
        case 'restart':
          await mcpCommands.restart(options);
          break;
        case 'status':
          mcpCommands.status();
          break;
        default:
          console.error(`Unknown mcp subcommand: ${subcommand}`);
          console.log('See: copilot-cli mcp --help');
          process.exit(1);
      }
      break;
      
    case 'config':
      if (!subcommand || options.help) {
        console.log(configHelp);
        process.exit(0);
      }
      
      switch (subcommand) {
        case 'get':
          if (!args[2]) {
            console.error('Error: Key required for config get');
            process.exit(1);
          }
          configCommands.get(args[2]);
          break;
        case 'set':
          if (!args[2] || !args[3]) {
            console.error('Error: Key and value required for config set');
            process.exit(1);
          }
          configCommands.set(args[2], args[3]);
          break;
        case 'list':
          configCommands.list();
          break;
        case 'reset':
          configCommands.reset();
          break;
        default:
          console.error(`Unknown config subcommand: ${subcommand}`);
          console.log('See: copilot-cli config --help');
          process.exit(1);
      }
      break;
      
    case 'status':
      if (options.help) {
        console.log(statusHelp);
        process.exit(0);
      }
      statusCommand.status(options);
      break;
      
    case 'chat':
      const chatPrompt = args.slice(1).join(' ');
      if (!chatPrompt || options.help) {
        console.log('Usage: copilot-cli chat "<prompt>"');
        console.log('\nExamples:');
        console.log('  $ copilot-cli chat "What is TypeScript?"');
        console.log('  $ copilot-cli chat "Explain async/await in JavaScript"');
        process.exit(0);
      }
      await chatCommand.chat(chatPrompt);
      break;
      
    case 'model':
      if (!subcommand || options.help) {
        console.log(modelHelp);
        process.exit(0);
      }
      
      switch (subcommand) {
        case 'list':
          await modelCommands.list();
          break;
        case 'refresh':
          await modelCommands.refresh();
          break;
        case 'set':
          await modelCommands.set(args[2]);
          break;
        case 'info':
          await modelCommands.info();
          break;
        default:
          console.error(`Unknown model subcommand: ${subcommand}`);
          console.log('See: copilot-cli model --help');
          process.exit(1);
      }
      break;
      
    default:
      console.error(`Unknown command: ${command}`);
      console.log(helpText);
      process.exit(1);
  }
}

main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});