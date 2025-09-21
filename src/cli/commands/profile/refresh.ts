import { getCopilotToken } from '../../../core/auth.js';
import { ModelCatalog } from '../../../core/model-catalog.js';
import { saveAuthProfile, requireActiveProfile } from './shared.js';

export async function refreshProfile(): Promise<void> {
  const { id, profile } = requireActiveProfile();
  const catalog = ModelCatalog.getInstance();

  try {
    console.log(`Refreshing Copilot token for profile: ${id}...`);
    const newToken = await getCopilotToken(profile.githubToken);

    let models: string[] | undefined = profile.models;

    console.log('Refreshing model catalog...');
    try {
      const entry = await catalog.refresh({
        profileId: id,
        token: newToken,
        verify: true,
        source: 'manual'
      });
      models = entry.models;
      console.log(`✓ Model catalog refreshed (${entry.models.length} working model${entry.models.length === 1 ? '' : 's'})`);
    } catch (error: any) {
      console.warn(`⚠ Model catalog refresh failed: ${error?.message || error}`);
      console.warn('Run: copilot dev doctor -- to inspect issues.');
    }

    saveAuthProfile(id, {
      ...profile,
      token: newToken,
      models,
      timestamp: Date.now()
    });

    console.log('✓ Token refreshed successfully');
  } catch (error: any) {
    console.error('Failed to refresh profile:', error?.message || error);
    console.error('Run: copilot profile login');
    process.exit(1);
  }
}
