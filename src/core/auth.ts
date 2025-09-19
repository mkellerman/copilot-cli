import https from 'https';
import { exec } from 'child_process';
import os from 'os';
import { AuthProvider } from './auth-providers.js';
import { loadToken, loadAuthInfo, saveAuthInfo, loadAuthProfiles, saveAuthProfile, getActiveProfile, setActiveProfile } from '../config/index.js';
import { CopilotHttpClient } from './copilot-client.js';
import { ModelCatalog } from './model-catalog.js';

const GITHUB_DEVICE_AUTH_URL = 'https://github.com/login/device/code';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval?: number;
}

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
  interval?: number;
}

interface CopilotTokenResponse {
  token: string;
}

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
}

function httpsRequest<T = any>(url: string, options: any, data?: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + (urlObj.search || ''),
      method: options.method || 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'copilot-proxy',
        ...options.headers
      }
    };

    if (data) {
      reqOptions.headers['Content-Length'] = Buffer.byteLength(data).toString();
    }

    const req = https.request(reqOptions, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(parsed.error || parsed.error_description || `HTTP ${res.statusCode}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${responseData}`));
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const copilotClient = CopilotHttpClient.getInstance();
const modelCatalog = ModelCatalog.getInstance();

function openBrowser(url: string): Promise<boolean> {
  const platform = os.platform();
  let command: string;

  if (platform === 'darwin') {
    command = `open "${url}"`;
  } else if (platform === 'win32') {
    command = `start "${url}"`;
  } else {
    command = `xdg-open "${url}" || sensible-browser "${url}" || x-www-browser "${url}" || gnome-open "${url}"`;
  }

  return new Promise((resolve) => {
    exec(command, (error) => {
      resolve(!error);
    });
  });
}

async function initiateDeviceAuth(provider: AuthProvider): Promise<DeviceAuthResponse> {
  const data = JSON.stringify({
    client_id: provider.clientId,
    scope: provider.scopes
  });

  return httpsRequest<DeviceAuthResponse>(GITHUB_DEVICE_AUTH_URL, { method: 'POST' }, data);
}

async function pollForToken(provider: AuthProvider, deviceCode: string, interval: number = 5): Promise<string> {
  const data = JSON.stringify({
    client_id: provider.clientId,
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
  });

  while (true) {
    try {
      const response = await httpsRequest<TokenResponse>(GITHUB_TOKEN_URL, { method: 'POST' }, data);
      
      if (response.access_token) {
        return response.access_token;
      }
      
      if (response.error === 'authorization_pending') {
        await new Promise(resolve => setTimeout(resolve, interval * 1000));
        continue;
      }
      
      if (response.error === 'slow_down') {
        interval = response.interval || interval + 5;
        await new Promise(resolve => setTimeout(resolve, interval * 1000));
        continue;
      }
      
      throw new Error(response.error_description || response.error || 'Unknown error');
    } catch (error: any) {
      if (error.message.includes('authorization_pending')) {
        await new Promise(resolve => setTimeout(resolve, interval * 1000));
        continue;
      }
      throw error;
    }
  }
}

export async function getGitHubUser(githubToken: string): Promise<GitHubUser> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: '/user',
      method: 'GET',
      headers: {
        'Authorization': `token ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'copilot-proxy'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const parsed: GitHubUser = JSON.parse(data);
            resolve(parsed);
          } catch (e) {
            reject(new Error('Failed to parse user response'));
          }
        } else {
          reject(new Error(`Failed to get user info: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

export async function getCopilotToken(githubToken: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: '/copilot_internal/v2/token',
      method: 'GET',
      headers: {
        'Authorization': `token ${githubToken}`,
        'Accept': 'application/json',
        'User-Agent': 'GitHubCopilotChat/0.11.0',
        'Editor-Version': 'vscode/1.85.0',
        'Editor-Plugin-Version': 'copilot-chat/0.11.0'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const parsed: CopilotTokenResponse = JSON.parse(data);
            resolve(parsed.token);
          } catch (e) {
            resolve(githubToken);
          }
        } else if (res.statusCode === 404 || res.statusCode === 401) {
          resolve(githubToken);
        } else {
          reject(new Error(`Failed to get Copilot token: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on('error', () => {
      resolve(githubToken);
    });

    req.end();
  });
}

export async function deviceAuth(provider: AuthProvider): Promise<{ copilotToken: string; githubToken: string; user: GitHubUser }> {
  console.log(`\n🔐 Starting authentication with ${provider.name}...\n`);

  try {
    const deviceAuthResponse = await initiateDeviceAuth(provider);
    const { user_code, verification_uri, device_code, interval } = deviceAuthResponse;

    console.log('Please authorize this device:\n');
    console.log(`1. Visit: ${verification_uri}`);
    console.log(`2. Enter code: ${user_code}\n`);

    const browserOpened = await openBrowser(verification_uri);
    if (browserOpened) {
      console.log('✓ Browser opened automatically');
    } else {
      console.log('Please open the URL manually in your browser');
    }

    console.log('\nWaiting for authorization...');

    const githubToken = await pollForToken(provider, device_code, interval || 5);
    
    console.log('\n✓ GitHub authentication successful!');
    
    console.log('Getting user information...');
    const user = await getGitHubUser(githubToken);

    console.log('Configuring for GitHub Copilot...');
    const copilotToken = await getCopilotToken(githubToken);

    return { copilotToken, githubToken, user };
  } catch (error: any) {
    throw new Error(`Authentication failed: ${error.message}`);
  }
}

export async function getValidToken(): Promise<string | null> {
  const activeProfile = getActiveProfile();
  if (!activeProfile) {
    return null;
  }
  
  const profiles = loadAuthProfiles();
  const profile = profiles[activeProfile];
  if (!profile) {
    return null;
  }
  
  // Test if token is valid
  const isValid = await copilotClient.verifyModel(profile.token, 'gpt-4');

  if (isValid) {
    return profile.token;
  }

  // Token is invalid/expired, try to refresh silently
  if (profile.githubToken) {
    try {
      const newToken = await getCopilotToken(profile.githubToken);
      saveAuthProfile(activeProfile, {
        ...profile,
        token: newToken,
        timestamp: Date.now()
      });
      return newToken;
    } catch (error) {
      console.error('Failed to refresh token automatically. Run: copilot-cli auth login');
    }
  }

  return null;
}

export async function testModels(
  token: string,
  profileId?: string,
  options: { verify?: boolean; signal?: AbortSignal; concurrency?: number } = {}
): Promise<string[]> {
  const verify = options.verify ?? true;

  if (profileId) {
    try {
      const entry = await modelCatalog.refresh({
        profileId,
        token,
        verify,
        signal: options.signal,
        concurrency: options.concurrency,
        source: 'manual'
      });
      return entry.models;
    } catch {
      // Fall back to direct probe below
    }
  }

  try {
    const models = await copilotClient.listModels(token);
    const modelIds = models.map(model => model.id).filter(Boolean);
    if (modelIds.length === 0) {
      return [];
    }
    if (!verify) {
      return modelIds;
    }
    return await testWorkingModels(token, modelIds);
  } catch {
    return [];
  }
}

export interface CopilotModelInfo {
  id: string;
  owned_by?: string;
  object?: string;
  created?: number;
}

// Fetch raw models from Copilot without probing each one
export async function listModels(token: string): Promise<CopilotModelInfo[]> {
  try {
    const models = await copilotClient.listModels(token);
    return models.map((model) => ({
      id: model.id,
      owned_by: model.owned_by,
      object: model.object,
      created: model.created
    }));
  } catch {
    return [];
  }
}

async function testWorkingModels(token: string, allModels: string[]): Promise<string[]> {
  const workingModels: string[] = [];
  
  console.log(`Testing ${allModels.length} models for availability...`);
  
  // Test models in parallel but limit concurrency to avoid rate limits
  const concurrency = 3;
  const chunks = [];
  for (let i = 0; i < allModels.length; i += concurrency) {
    chunks.push(allModels.slice(i, i + concurrency));
  }
  
  for (const chunk of chunks) {
    const promises = chunk.map(async (modelId) => {
      const isWorking = await testSingleModel(token, modelId);
      if (isWorking) {
        process.stdout.write('✓');
        return modelId;
      } else {
        process.stdout.write('✗');
        return null;
      }
    });
    
    const results = await Promise.all(promises);
    workingModels.push(...results.filter(Boolean) as string[]);
  }
  
  console.log(`\nFound ${workingModels.length} working models.`);
  return workingModels;
}

async function testSingleModel(token: string, modelId: string): Promise<boolean> {
  return copilotClient.verifyModel(token, modelId);
}
