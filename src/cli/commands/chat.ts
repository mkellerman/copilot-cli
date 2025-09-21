import { ConfigManager } from '../../core/config-manager.js';
import { CopilotChatCompletionRequest, CopilotHttpClient } from '../../core/copilot-client.js';
import { parseInChatCommand } from '../../api/commands/index.js';
import { renderCommandText } from '../../api/commands/text.js';
import { getValidToken } from '../../core/auth.js';

interface ChatResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

async function makeRequest(token: string, prompt: string): Promise<ChatResponse> {
  const config = ConfigManager.getInstance();
  let model = config.get<string>('model.default');
  const client = CopilotHttpClient.getInstance();

  if (!model) {
    // No default model set, fetch available models and use the first one
    try {
      const models = await client.listModels(token);
      if (models.length > 0) {
        model = models[0].id;
      } else {
        model = 'gpt-4'; // fallback if no models available
      }
    } catch {
      model = 'gpt-4'; // fallback if error fetching models
    }
  }

  const payload: CopilotChatCompletionRequest = {
    messages: [{ role: 'user', content: prompt }],
    model,
    temperature: 0.1,
    max_tokens: 4096,
    stream: false
  };

  const response = await client.postChatCompletion(token, payload);
  const text = await response.text();

  if (!response.ok) {
    let message = text || `Request failed with status ${response.status}`;
    if (text) {
      try {
        const parsed = JSON.parse(text);
        message = parsed?.error?.message || message;
      } catch {
        // ignore
      }
    }
    throw new Error(message);
  }

  if (!text) {
    throw new Error('Empty response from GitHub Copilot');
  }

  try {
    return JSON.parse(text) as ChatResponse;
  } catch {
    throw new Error('Failed to parse response');
  }
}


export async function runChatCommand(prompt: string): Promise<void> {
  // Check for in-chat command first
  const parsedCmd = parseInChatCommand(prompt);
  if (parsedCmd && parsedCmd.command === '--models') {
    const token = await getValidToken();
    if (!token) {
      console.error('Error: Not authenticated or unable to refresh token');
      console.error('Run: copilot profile login');
      process.exit(1);
    }
    try {
      const client = CopilotHttpClient.getInstance();
      const models = await client.listModels(token!);
      if (models.length === 0) {
        console.log('No models available.');
      } else {
        // Determine selected model (default or first)
        const config = ConfigManager.getInstance();
        let selected = config.get<string>('model.default');
        if (!selected) selected = models[0].id;

        console.log('Available models:');
        for (const model of models) {
          if (model.id === selected) {
            console.log(`* ${model.id}   ← currently selected`);
          } else {
            console.log(`  ${model.id}`);
          }
        }
  // Show how to set the model, using the first one as an example (in-chat command)
  console.log('\nTo set the desired model, run:');
  console.log(`  ::config set model.default ${models[0].id}`);
      }
    } catch (err: any) {
      console.error('Error fetching models:', err.message || err);
      process.exit(1);
    }
    return;
  } else if (parsedCmd && parsedCmd.command === '--config') {
    const config = ConfigManager.getInstance();
    const args = parsedCmd.args;
    if (args.length === 0) {
      // List all config
      const all = config.list();
      console.log('Current configuration:');
      for (const [key, value] of Object.entries(all)) {
        console.log(`  ${key}: ${JSON.stringify(value)}`);
      }
    } else if (args[0] === 'set' && args.length >= 3) {
      // Set config value
      const key = args[1];
      const value = args.slice(2).join(' ');
      try {
        await config.set(key as any, value);
        console.log(`Set ${key} = ${value}`);
      } catch (err: any) {
        console.error(`Failed to set config: ${err.message || err}`);
        process.exit(1);
      }
    } else {
      // Show value for a specific key
      const key = args[0];
      const value = config.get(key as any);
      if (value === undefined) {
        console.log(`No value set for '${key}'.`);
      } else {
        console.log(`${key}: ${JSON.stringify(value)}`);
      }
    }
    return;
    const token = await getValidToken();
    if (!token) {
      console.error('Error: Not authenticated or unable to refresh token');
      console.error('Run: copilot profile login');
      process.exit(1);
    }
    try {
      const client = CopilotHttpClient.getInstance();
  const models = await client.listModels(token!);
      if (models.length === 0) {
        console.log('No models available.');
      } else {
        // Determine selected model (default or first)
        const config = ConfigManager.getInstance();
        let selected = config.get<string>('model.default');
        if (!selected) selected = models[0].id;

        console.log('Available models:');
        for (const model of models) {
          if (model.id === selected) {
            console.log(`* ${model.id}   ← currently selected`);
          } else {
            console.log(`  ${model.id}`);
          }
        }
        // Show how to set the model, using the first one as an example
        console.log('\nTo set the desired model, run:');
        console.log(`  copilot config set model.default ${models[0].id}`);
      }
    } catch (err: any) {
      console.error('Error fetching models:', err.message || err);
      process.exit(1);
    }
    return;
  } else if (parsedCmd) {
    // For other in-chat commands, use the default handler
    const output = renderCommandText(parsedCmd.command, parsedCmd.args, new Map(), {});
    console.log(output);
    return;
  }

  const token = await getValidToken();
  if (!token) {
    console.error('Error: Not authenticated or unable to refresh token');
    console.error('Run: copilot profile login');
    process.exit(1);
  }

  try {
    const response = await makeRequest(token, prompt);

    const content = response.choices?.[0]?.message?.content;
    if (content) {
      console.log(content);
    } else {
      console.error('No response from Copilot');
    }
  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}
