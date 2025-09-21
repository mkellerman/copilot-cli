import { getProvider, readProfiles } from './shared.js';

export function listProfiles(): void {
  const { profiles, activeId } = readProfiles();
  const entries = Object.entries(profiles);

  console.log('\nAuthentication Profiles');
  console.log('=======================\n');

  if (entries.length === 0) {
    console.log('No authentication profiles found.');
    console.log('Run: copilot profile login\n');
    return;
  }

  for (const [id, profile] of entries) {
    const isActive = id === activeId;
    const marker = isActive ? '▶ ' : '  ';
    const provider = getProvider(profile.provider);
    console.log(`${marker}${id}`);
    console.log(`    User: ${profile.user.name || profile.user.login} (@${profile.user.login})`);
    console.log(`    Provider: ${provider?.name || profile.provider}`);
    if (profile.models?.length) {
      console.log(`    Models: ${profile.models.length} available`);
    }

    const ageMs = Date.now() - profile.timestamp;
    const hours = Math.floor(ageMs / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    if (days > 0) {
      console.log(`    Age: ${days} day${days > 1 ? 's' : ''}`);
    } else {
      console.log(`    Age: ${hours} hour${hours !== 1 ? 's' : ''}`);
    }
    console.log();
  }

  if (!activeId) {
    console.log('No active profile set. Use: copilot profile switch <profileId>');
  }
}
