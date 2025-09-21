import { ConfigManager } from '../../core/config-manager.js';
import { CopilotChatCompletionRequest, CopilotHttpClient } from '../../core/copilot-client.js';
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
  const defaultModel = config.get<string>('model.default') || 'gpt-4';
  const client = CopilotHttpClient.getInstance();

  const payload: CopilotChatCompletionRequest = {
    messages: [{ role: 'user', content: prompt }],
    model: defaultModel,
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
        // ignore parse errors, use raw text
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

export async function chat(prompt: string): Promise<void> {
  const token = await getValidToken();
  
  if (!token) {
    console.error('Error: Not authenticated or unable to refresh token');
    console.error('Run: copilot-cli auth login');
    process.exit(1);
  }
  
  try {
    const response = await makeRequest(token, prompt);
    
    if (response.choices && response.choices[0]?.message?.content) {
      console.log(response.choices[0].message.content);
    } else {
      console.error('No response from Copilot');
    }
  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}
