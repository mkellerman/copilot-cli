import { getCommandTriggers } from './index.js';

export function renderCommandText(
  command: string,
  args: string[],
  overrides: Map<string, string>,
  defaults: Record<string, string>
): string {
  const lines: string[] = [];
  const combined = new Map<string, string>(Object.entries(defaults));
  overrides.forEach((value, key) => combined.set(key, value));
  const triggers = getCommandTriggers();
  const primary = triggers[0] || '--';

  switch (command) {
    case '--help':
      lines.push('In-chat commands:');
      lines.push(`Prefix: ${triggers.join(', ')} (default '${primary}')`);
      lines.push(`${primary}help                 show this help`);
      lines.push(`${primary}models               list available models`);
      lines.push(`${primary}set-model <anthropic> <copilot>   override mapping for this session`);
      lines.push(`${primary}reset-models         restore default session mappings`);
      break;
    case '--models':
      lines.push('Mapped models:');
      if (combined.size === 0) {
        lines.push('(no mappings configured)');
      } else {
        for (const [anthropicModel, copilotModel] of combined.entries()) {
          lines.push(`- ${anthropicModel} → ${copilotModel}`);
        }
      }
      break;
    case '--set-model': {
      const message = applySetModelCommand(args, overrides);
      lines.push(message);
      break;
    }
    case '--reset-models': {
      const message = applyResetModelsCommand(overrides);
      lines.push(message);
      break;
    }
    default:
      lines.push(`Unknown in-chat command: ${command}`);
      lines.push('Try --help for available commands.');
      break;
  }

  return lines.join('\n');
}

function applySetModelCommand(args: string[], mapping: Map<string, string>): string {
  if (args.length < 2) {
    return 'Usage: --set-model <anthropic_model> <copilot_model>';
  }
  const anthropic = args[0].trim();
  const copilot = args[1].trim();
  mapping.set(anthropic, copilot);
  return `Mapped ${anthropic} → ${copilot}`;
}

function applyResetModelsCommand(mapping: Map<string, string>): string {
  mapping.clear();
  return 'Mappings reset to defaults';
}
