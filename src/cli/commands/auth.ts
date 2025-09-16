import https from 'https';
import readline from 'readline';
import { deviceAuth, getCopilotToken, testModels, getValidToken, listModels } from '../../core/auth.js';
import { saveToken, loadToken, deleteToken, saveAuthInfo, loadAuthInfo, loadAuthProfiles, saveAuthProfile, getActiveProfile, setActiveProfile, generateProfileId, deleteAuthProfile, AuthProfile } from '../../config/index.js';
import { AUTH_PROVIDERS, getProvider } from '../../core/auth-providers.js';
import fs from 'fs';

function askForProvider(): Promise<string> {
  return new Promise((resolve) => {
    console.log('\nSelect authentication provider:');
    console.log('================================\n');
    
    AUTH_PROVIDERS.forEach((provider, index) => {
      console.log(`${index + 1}. ${provider.name} ${provider.owner ? `by ${provider.owner}` : ''}`);
      // console.log(`    `);
      // console.log(`    Permissions: ${provider.scopes || 'minimal'}\n`);
    });
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question('Choose provider (1-' + AUTH_PROVIDERS.length + '): ', (answer) => {
      rl.close();
      const index = parseInt(answer) - 1;
      if (index >= 0 && index < AUTH_PROVIDERS.length) {
        resolve(AUTH_PROVIDERS[index].id);
      } else {
        console.log('Invalid selection, using default (VS Code)');
        resolve('vscode');
      }
    });
  });
}

export async function login(providerId?: string): Promise<void> {
  try {
    // If no provider specified, ask user
    if (!providerId) {
      providerId = await askForProvider();
    }
    
    const provider = getProvider(providerId);
    if (!provider) {
      console.error('Invalid provider');
      process.exit(1);
    }
    
    const { copilotToken, githubToken, user } = await deviceAuth(provider);
    
    // Test what models are available
    console.log('\nTesting model access...');
    const models = await testModels(copilotToken);
    
    // Generate profile ID
    const profileId = generateProfileId(provider.id, user.login);
    
    // Save auth profile
    const profile: AuthProfile = {
      id: profileId,
      token: copilotToken,
      githubToken,
      provider: provider.id,
      timestamp: Date.now(),
      models,
      user
    };
    
    saveAuthProfile(profileId, profile);
    setActiveProfile(profileId);
    
    console.log('\n✓ Authentication successful!');
    console.log(`  Provider: ${provider.name}`);
    console.log(`  User: ${user.name || user.login} (@${user.login})`);
    console.log(`  Profile ID: ${profileId}`);
    
    if (models.length > 0) {
      console.log(`  Available models: ${models.length} models`);
    } else {
      console.log('  Models: Unable to retrieve (will use defaults)');
    }
  } catch (error: any) {
    console.error('\n❌ Authentication failed:', error.message);
    process.exit(1);
  }
}

export function logout(profileId?: string): void {
  if (profileId) {
    // Logout specific profile
    if (deleteAuthProfile(profileId)) {
      console.log(`✓ Successfully logged out profile: ${profileId}`);
      const activeProfile = getActiveProfile();
      if (activeProfile) {
        console.log(`Active profile switched to: ${activeProfile}`);
      } else {
        console.log('No remaining profiles. Please run: copilot-cli auth login');
      }
    } else {
      console.log(`Profile not found: ${profileId}`);
    }
  } else {
    // Logout current profile
    const activeProfile = getActiveProfile();
    if (activeProfile) {
      if (deleteAuthProfile(activeProfile)) {
        console.log(`✓ Successfully logged out profile: ${activeProfile}`);
        const newActiveProfile = getActiveProfile();
        if (newActiveProfile) {
          console.log(`Active profile switched to: ${newActiveProfile}`);
        } else {
          console.log('No remaining profiles. Please run: copilot-cli auth login');
        }
      } else {
        console.log('Failed to logout');
      }
    } else {
      // Fallback to old auth system
      if (deleteToken()) {
        console.log('✓ Successfully logged out');
      } else {
        console.log('No authentication found');
      }
    }
  }
}

async function validateToken(token: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Test against Copilot API directly instead of GitHub API
    const testData = JSON.stringify({
      messages: [{ role: 'user', content: 'test' }],
      model: 'gpt-4',
      max_tokens: 1,
      temperature: 0
    });

    const options = {
      hostname: 'api.githubcopilot.com',
      port: 443,
      path: '/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(testData).toString(),
        'Editor-Version': 'vscode/1.85.0',
        'Editor-Plugin-Version': 'copilot-chat/0.11.0',
        'Openai-Organization': 'github-copilot',
        'User-Agent': 'GitHubCopilotChat/0.11.0'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // 200 = valid token, 401 = invalid/expired
        resolve(res.statusCode === 200);
      });
    });

    req.on('error', () => resolve(false));
    req.write(testData);
    req.end();
  });
}

export async function list(): Promise<void> {
  const profiles = loadAuthProfiles();
  const activeProfileId = getActiveProfile();
  
  console.log('\nAuthentication Profiles');
  console.log('=======================\n');
  
  if (Object.keys(profiles).length === 0) {
    console.log('No authentication profiles found.');
    console.log('Run: copilot-cli auth login\n');
    return;
  }
  
  Object.entries(profiles).forEach(([id, profile]) => {
    const isActive = id === activeProfileId;
    const marker = isActive ? '▶ ' : '  ';
    const provider = getProvider(profile.provider);
    
    console.log(`${marker}${id}`);
    console.log(`    User: ${profile.user.name || profile.user.login} (@${profile.user.login})`);
    console.log(`    Provider: ${provider?.name || profile.provider}`);
    
    if (profile.models && profile.models.length > 0) {
      console.log(`    Models: ${profile.models.length} available`);
    }
    
    const age = Date.now() - profile.timestamp;
    const hours = Math.floor(age / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    if (days > 0) {
      console.log(`    Age: ${days} day${days > 1 ? 's' : ''}`);
    } else {
      console.log(`    Age: ${hours} hour${hours !== 1 ? 's' : ''}`);
    }
    console.log();
  });
  
  if (!activeProfileId) {
    console.log('No active profile set. Use: copilot-cli auth switch <profile>');
  }
}

export function switchProfile(profileId: string): void {
  const profiles = loadAuthProfiles();
  
  if (!profiles[profileId]) {
    console.error(`Profile not found: ${profileId}`);
    console.log('\nAvailable profiles:');
    Object.keys(profiles).forEach(id => {
      const profile = profiles[id];
      console.log(`  ${id} (${profile.user.name || profile.user.login})`);
    });
    process.exit(1);
  }
  
  setActiveProfile(profileId);
  const profile = profiles[profileId];
  console.log(`✓ Switched to profile: ${profileId}`);
  console.log(`  User: ${profile.user.name || profile.user.login} (@${profile.user.login})`);
}

export async function status(options: { json?: boolean; verbose?: boolean } = {}): Promise<void> {
  const token = await getValidToken();
  const activeProfileId = getActiveProfile();
  const profiles = loadAuthProfiles();
  
  
  if (token && activeProfileId && profiles[activeProfileId]) {
    const profile = profiles[activeProfileId];
    if (options.json) {
      const provider = getProvider(profile.provider);
      const otherProfiles = Object.keys(profiles).filter(id => id !== activeProfileId);
      const output = {
        authentication: {
          status: 'active' as const,
          activeProfile: activeProfileId,
          user: {
            login: profile.user.login,
            name: profile.user.name || null
          },
          provider: provider?.id || profile.provider,
          token: `${token.substring(0, 10)}...${token.slice(-4)}`,
          models: profile.models || [],
          otherProfiles
        }
      };
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log('\nGitHub Copilot Authentication Status');
      console.log('====================================');
      console.log('✓ Authenticated');
      console.log(`  Active Profile: ${activeProfileId}`);
      console.log(`  User: ${profile.user.name || profile.user.login} (@${profile.user.login})`);
      console.log(`  Token: ${token.substring(0, 10)}...${token.slice(-4)}`);
      
      const provider = getProvider(profile.provider);
      if (provider) {
        console.log(`  Provider: ${provider.name}`);
      }
      if (profile.models && profile.models.length > 0) {
        console.log(`  Models: ${profile.models.length} available`);
      }
      const age = Date.now() - profile.timestamp;
      const hours = Math.floor(age / (1000 * 60 * 60));
      const days = Math.floor(hours / 24);
      if (days > 0) {
        console.log(`  Age: ${days} day${days > 1 ? 's' : ''}`);
      } else {
        console.log(`  Age: ${hours} hour${hours !== 1 ? 's' : ''}`);
      }
      
      // Show other available profiles
      const otherProfiles = Object.keys(profiles).filter(id => id !== activeProfileId);
      if (otherProfiles.length > 0) {
        console.log(`\n  Other profiles: ${otherProfiles.length}`);
        otherProfiles.forEach(id => {
          const p = profiles[id];
          console.log(`    - ${id} (${p.user.name || p.user.login})`);
        });
        console.log(`\n  Use 'copilot-cli auth switch <profile>' to change active profile`);
      }
      console.log();
    }
  } else {
    if (options.json) {
      const output = {
        authentication: {
          status: 'inactive' as const
        }
      };
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log('\nGitHub Copilot Authentication Status');
      console.log('====================================');
      console.log('✗ Not authenticated');
      console.log('Run: copilot-cli auth login\n');
    }
    // Exit 0 for status reporting; non-zero reserved for operational failures
  }
}

export async function refresh(): Promise<void> {
  const activeProfileId = getActiveProfile();
  const profiles = loadAuthProfiles();
  
  if (!activeProfileId || !profiles[activeProfileId]) {
    console.error('No active profile found. Please login first.');
    console.error('Run: copilot-cli auth login\n');
    process.exit(1);
  }
  
  const profile = profiles[activeProfileId];
  
  try {
    console.log(`Refreshing token for profile: ${activeProfileId}...`);
    // Always get a fresh Copilot token from the GitHub token
    const newToken = await getCopilotToken(profile.githubToken);
    
    // Update profile with new token
    saveAuthProfile(activeProfileId, {
      ...profile,
      token: newToken,
      timestamp: Date.now()
    });
    
    console.log('✓ Token refreshed successfully');
  } catch (error: any) {
    console.error('Failed to refresh token:', error.message);
    console.error('Run: copilot-cli auth login');
    process.exit(1);
  }
}

type InventoryArgs = { providers?: string; output?: string };

export async function inventory(args: InventoryArgs): Promise<void> {
  // Determine provider list
  let providers = AUTH_PROVIDERS;
  if (args.providers) {
    const ids = args.providers.split(',').map(s => s.trim()).filter(Boolean);
    providers = AUTH_PROVIDERS.filter(p => ids.includes(p.id));
    if (providers.length === 0) {
      console.error('No matching providers for ids:', ids.join(', '));
      process.exit(1);
    }
  }

  console.log(`\nStarting inventory across ${providers.length} providers...`);

  const rows: Array<{ providerId: string; providerName: string; clientId: string; userLogin: string; userName: string | null; modelId: string }>=[];

  for (const provider of providers) {
    console.log(`\n=== Provider: ${provider.name} (${provider.id}) ===`);
    try {
      const { copilotToken, user } = await deviceAuth(provider);
      console.log(`Authenticated as ${user.name || user.login} (@${user.login})`);

      const models = await listModels(copilotToken);
      if (!models || models.length === 0) {
        console.log('No models returned');
      }
      for (const m of models) {
        rows.push({
          providerId: provider.id,
          providerName: provider.name,
          clientId: provider.clientId,
          userLogin: user.login,
          userName: user.name,
          modelId: m.id,
        });
      }
    } catch (e: any) {
      console.log(`Provider failed: ${e.message || e}`);
    }
  }

  // Build CSV
  const header = ['provider_id','provider_name','client_id','user_login','user_name','model_id'];
  const csvLines = [header.join(',')];
  const csvEscape = (s: string) => {
    const needsQuotes = /[",\r\n]/.test(s);
    const doubled = s.replace(/"/g, '""');
    return needsQuotes ? '"' + doubled + '"' : doubled;
  };
  for (const r of rows) {
    const vals = [r.providerId, r.providerName, r.clientId, r.userLogin, r.userName || '', r.modelId].map(csvEscape);
    csvLines.push(vals.join(','));
  }

  const csv = csvLines.join('\n') + '\n';
  if (args.output) {
    fs.writeFileSync(args.output, csv, 'utf8');
    console.log(`\n✓ Inventory written to ${args.output} (${rows.length} rows)`);
  } else {
    console.log('\n' + csv);
  }
}

// --- Discover client_ids via GitHub Search API ---
type DiscoverArgs = { token?: string; query?: string; limit?: number; output?: string };

export async function discover(args: DiscoverArgs): Promise<void> {
  const token = (args.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  if (!token) {
    console.error('GitHub token required. Pass --token or set GITHUB_TOKEN.');
    process.exit(1);
  }

  const query = args.query || '"github.com/login/device/code" client_id in:file';
  const limit = Math.max(1, Math.min(args.limit ?? 150, 500));

  const searchPerPage = 100; // max per_page
  let page = 1;
  const found: Array<{ clientId: string; repo: string; path: string; html_url: string }>=[];
  const seenIds = new Set<string>();

  async function githubGetJson<T>(path: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        port: 443,
        path,
        method: 'GET',
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'copilot-cli'
        }
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error('Failed to parse JSON'));
            }
          } else {
            reject(new Error(`GitHub API ${res.statusCode}: ${data}`));
          }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  function extractClientIds(content: string): string[] {
    const ids = new Set<string>();
    // Patterns: JSON client_id: "Iv1.x" or hex; querystring client_id=...
    const jsonPattern = /client_id\s*[:=]\s*["']([^"']+)["']/gi;
    const qsPattern = /client_id=([A-Za-z0-9_.\-]+)/gi;
    const candidates: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = jsonPattern.exec(content))) candidates.push(m[1]);
    while ((m = qsPattern.exec(content))) candidates.push(m[1]);

    for (const c of candidates) {
      const s = c.trim();
      if (/^Iv1\.[A-Za-z0-9]+$/.test(s)) ids.add(s);
      else if (/^[a-f0-9]{20}$/i.test(s)) ids.add(s);
      else if (/^[a-f0-9]{32}$/i.test(s)) ids.add(s);
    }
    return Array.from(ids);
  }

  console.log(`\nSearching GitHub code for: ${query}`);
  while (found.length < limit) {
    const encoded = encodeURIComponent(query);
    const pagePath = `/search/code?q=${encoded}&per_page=${searchPerPage}&page=${page}`;
    let searchResp: any;
    try {
      searchResp = await githubGetJson<any>(pagePath);
    } catch (e: any) {
      console.error(`Search failed on page ${page}: ${e.message || e}`);
      break;
    }

    const items: any[] = Array.isArray(searchResp.items) ? searchResp.items : [];
    if (items.length === 0) break;

    for (const item of items) {
      if (found.length >= limit) break;
      const repoFull = item.repository?.full_name || '';
      const path = item.path || '';
      const html_url = item.html_url || '';
      const sha = item.sha || item.repository?.default_branch || 'main';
      // Get file content
      const contentsPath = `/repos/${encodeURIComponent(repoFull)}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(sha)}`;
      try {
        const file = await githubGetJson<any>(contentsPath);
        const encoded = file?.content;
        const encoding = file?.encoding;
        let content = '';
        if (encoded && encoding === 'base64') {
          content = Buffer.from(encoded, 'base64').toString('utf8');
        } else if (typeof encoded === 'string') {
          content = encoded as string;
        }
        const ids = extractClientIds(content);
        for (const id of ids) {
          if (!seenIds.has(id)) {
            seenIds.add(id);
            found.push({ clientId: id, repo: repoFull, path, html_url });
            if (found.length >= limit) break;
          }
        }
      } catch (e: any) {
        // ignore file fetch errors and continue
      }
    }

    page += 1;
  }

  // Output CSV
  const header = ['client_id','repo','path','html_url'];
  const lines = [header.join(',')];
  const csvEscape = (s: string) => {
    const needsQuotes = /[",\r\n]/.test(s);
    const doubled = s.replace(/"/g, '""');
    return needsQuotes ? '"' + doubled + '"' : doubled;
  };
  for (const r of found) {
    lines.push([r.clientId, r.repo, r.path, r.html_url].map(v => csvEscape(String(v))).join(','));
  }
  const csv = lines.join('\n') + '\n';
  if (args.output) {
    fs.writeFileSync(args.output, csv, 'utf8');
    console.log(`\n✓ Discovered ${found.length} unique client_id(s). Written to ${args.output}`);
  } else {
    console.log('\n' + csv);
  }
}