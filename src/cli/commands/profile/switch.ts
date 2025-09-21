import { readProfiles, setActiveProfile } from './shared.js';

export function switchProfile(profileId: string): void {
  const { profiles } = readProfiles();
  if (!profiles[profileId]) {
    console.error(`Profile not found: ${profileId}`);
    if (Object.keys(profiles).length > 0) {
      console.log('\nAvailable profiles:');
      for (const id of Object.keys(profiles)) {
        const profile = profiles[id];
        console.log(`  ${id} (${profile.user.name || profile.user.login})`);
      }
    }
    process.exit(1);
  }

  setActiveProfile(profileId);
  const profile = profiles[profileId];
  console.log(`✓ Switched to profile: ${profileId}`);
  console.log(`  User: ${profile.user.name || profile.user.login} (@${profile.user.login})`);
}
