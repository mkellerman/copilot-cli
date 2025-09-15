import readline from 'readline';
import { getActiveProfile, loadAuthProfiles, saveAuthProfile } from '../../config/index.js';
import { ConfigManager } from '../../core/config-manager.js';
import { testModels, getValidToken } from '../../core/auth.js';
import { getProvider } from '../../core/auth-providers.js';

interface Model {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
}

export async function fetchModels(token: string): Promise<Model[]> {
  try {
    const modelIds = await testModels(token);
    // Convert to Model interface format
    return modelIds.map(id => ({
      id,
      owned_by: 'github-copilot',
      object: 'model',
      created: Math.floor(Date.now() / 1000)
    }));
  } catch (error) {
    // Return default models on error
    return [
      { id: 'gpt-4', owned_by: 'github-copilot' },
      { id: 'gpt-3.5-turbo', owned_by: 'github-copilot' }
    ];
  }
}

export async function list(): Promise<void> {
  const activeProfileId = getActiveProfile();
  const profiles = loadAuthProfiles();
  
  if (!activeProfileId || !profiles[activeProfileId]) {
    console.error('Error: Not authenticated');
    console.error('Run: copilot-cli auth login');
    process.exit(1);
  }
  
  const profile = profiles[activeProfileId];
  const provider = getProvider(profile.provider);
  
  console.log(`\nUsing profile: ${activeProfileId} (${profile.user.name || profile.user.login})`);
  console.log(`Provider: ${provider?.name || profile.provider}\n`);
  
  // Use cached models from profile
  const modelIds = profile.models || [];
  const models: Model[] = modelIds.map(id => ({
    id,
    owned_by: 'github-copilot',
    object: 'model',
    created: Math.floor(Date.now() / 1000)
  }));
  
  if (models.length === 0) {
    console.log('✗ No models found in profile cache');
    console.log('Run: copilot-cli model refresh');
    return;
  }
  
  const config = ConfigManager.getInstance();
  const currentModel = config.get('model.default') || models[0].id;
  
  console.log('\nWorking Models:');
  console.log('===============\n');
  
  models.forEach((model) => {
    const isCurrent = model.id === currentModel;
    const marker = isCurrent ? '  ▶ ' : '    ';
    console.log(`${marker}${model.id}`);
  });
  
  console.log('\nCurrent default: ' + currentModel);
  
  // Show cache age
  const age = Date.now() - profile.timestamp;
  const hours = Math.floor(age / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  if (days > 0) {
    console.log(`Cache age: ${days} day${days > 1 ? 's' : ''}`);
  } else {
    console.log(`Cache age: ${hours} hour${hours !== 1 ? 's' : ''}`);
  }
  console.log('Use "copilot-cli model refresh" to update model list');
}

export async function refresh(): Promise<void> {
  const token = await getValidToken();
  const activeProfileId = getActiveProfile();
  const profiles = loadAuthProfiles();
  
  if (!token || !activeProfileId || !profiles[activeProfileId]) {
    console.error('Error: Not authenticated or unable to refresh token');
    console.error('Run: copilot-cli auth login');
    process.exit(1);
  }
  
  const profile = profiles[activeProfileId];
  const provider = getProvider(profile.provider);
  
  console.log(`\nUsing profile: ${activeProfileId} (${profile.user.name || profile.user.login})`);
  console.log(`Provider: ${provider?.name || profile.provider}\n`);
  console.log('Fetching and testing available models...');
  
  const models = await fetchModels(token);
  
  if (models.length === 0) {
    console.log('\n✗ No models available or unable to fetch models');
    console.log('This may be due to the authentication provider used.');
    return;
  }
  
  // Save the updated model list with the active profile
  const updatedProfile = profiles[activeProfileId];
  if (updatedProfile) {
    saveAuthProfile(activeProfileId, {
      ...updatedProfile,
      models: models.map(m => m.id),
      timestamp: Date.now() // Update timestamp to reflect refresh
    });
  }
  
  const config = ConfigManager.getInstance();
  const currentModel = config.get('model.default') || models[0]?.id || 'gpt-4';
  
  console.log('\nRefreshed Working Models:');
  console.log('=========================\n');
  
  models.forEach((model) => {
    const isCurrent = model.id === currentModel;
    const marker = isCurrent ? '  ▶ ' : '    ';
    console.log(`${marker}${model.id}`);
  });
  
  console.log(`\nFound ${models.length} working models`);
  console.log('Current default: ' + currentModel);
}

export async function set(modelId?: string): Promise<void> {
  const token = await getValidToken();
  
  if (!token) {
    console.error('Error: Not authenticated or unable to refresh token');
    console.error('Run: copilot-cli auth login');
    process.exit(1);
  }
  
  const models = await fetchModels(token);
  
  if (!modelId) {
    // Interactive selection
    if (models.length === 0) {
      console.error('No models available');
      process.exit(1);
    }
    
    console.log('\nSelect default model:');
    console.log('====================\n');
    
    models.forEach((model, index) => {
      console.log(`${index + 1}. ${model.id}`);
    });
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    await new Promise<void>((resolve) => {
      rl.question('\nChoose model (1-' + models.length + '): ', (answer) => {
        rl.close();
        const index = parseInt(answer) - 1;
        if (index >= 0 && index < models.length) {
          modelId = models[index].id;
        } else {
          console.error('Invalid selection');
          process.exit(1);
        }
        resolve();
      });
    });
  }
  
  // Validate model exists
  if (models.length > 0 && !models.find(m => m.id === modelId)) {
    console.error(`Model '${modelId}' is not available`);
    console.log('Available models:', models.map(m => m.id).join(', '));
    process.exit(1);
  }
  
  // Save model preference
  const config = ConfigManager.getInstance();
  config.set('model.default', modelId);
  
  console.log(`✓ Default model set to: ${modelId}`);
}

export async function info(): Promise<void> {
  const config = ConfigManager.getInstance();
  let currentModel = config.get('model.default');
  
  // Try to get more info if authenticated
  const token = await getValidToken();
  
  if (token) {
    const models = await fetchModels(token);
    currentModel = currentModel || models[0]?.id || 'gpt-4';
    
    console.log('\nModel Configuration:');
    console.log('===================');
    console.log(`Default model: ${currentModel}`);
    
    const model = models.find(m => m.id === currentModel);
    
    if (model) {
      console.log(`Status: ✓ Available`);
    } else if (models.length > 0) {
      console.log(`Status: ✗ Not available with current auth`);
      console.log(`\nAvailable models: ${models.map(m => m.id).join(', ')}`);
    }
  } else {
    currentModel = currentModel || 'gpt-4';
    
    console.log('\nModel Configuration:');
    console.log('===================');
    console.log(`Default model: ${currentModel}`);
  }
}