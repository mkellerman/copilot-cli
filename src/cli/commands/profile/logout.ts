import {
  deleteAuthProfile,
  getActiveProfile,
  loadAuthProfiles,
  deleteToken
} from '../../../config/index.js';

export function logout(profileId?: string): void {
  if (profileId) {
    if (deleteAuthProfile(profileId)) {
      console.log(`✓ Logged out profile: ${profileId}`);
      const remainingActive = getActiveProfile();
      if (remainingActive) {
        console.log(`Active profile switched to: ${remainingActive}`);
      } else {
        console.log('No remaining profiles. Run: copilot profile login');
      }
    } else {
      console.log(`Profile not found: ${profileId}`);
    }
    return;
  }

  const activeProfile = getActiveProfile();
  if (activeProfile) {
    if (deleteAuthProfile(activeProfile)) {
      console.log(`✓ Logged out profile: ${activeProfile}`);
      const nextActive = getActiveProfile();
      if (nextActive) {
        console.log(`Active profile switched to: ${nextActive}`);
      } else {
        console.log('No remaining profiles. Run: copilot profile login');
      }
    } else {
      console.log('Failed to logout active profile.');
    }
    return;
  }

  if (deleteToken()) {
    console.log('✓ Logged out legacy token.');
  } else {
    console.log('No authentication found. Run: copilot profile login');
  }
}
