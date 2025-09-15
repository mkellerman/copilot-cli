import https from 'https';
import { loadToken, loadAuthInfo } from '../../config/index.js';
import { COPILOT_HOST } from '../../config/index.js';
import { ConfigManager } from '../../core/config-manager.js';
import { getValidToken } from '../../core/auth.js';

interface ChatResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

function makeRequest(token: string, prompt: string): Promise<ChatResponse> {
  return new Promise((resolve, reject) => {
    const config = ConfigManager.getInstance();
    const defaultModel = config.get('model.default') || 'gpt-4';
    
    const data = JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      model: defaultModel,
      temperature: 0.1,
      max_tokens: 4096,
      stream: false
    });

    const options = {
      hostname: COPILOT_HOST,
      port: 443,
      path: '/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(data).toString(),
        'Editor-Version': 'vscode/1.85.0',
        'Editor-Plugin-Version': 'copilot-chat/0.11.0',
        'Openai-Organization': 'github-copilot',
        'User-Agent': 'GitHubCopilotChat/0.11.0'
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk.toString();
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const response = JSON.parse(responseData);
            resolve(response);
          } catch (e) {
            reject(new Error('Failed to parse response'));
          }
        } else {
          reject(new Error(`Request failed with status ${res.statusCode}: ${responseData}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
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