import { AUTH_PROVIDERS, getProvider } from '../../../core/auth-providers.js';
import {
  loadAuthProfiles,
  getActiveProfile,
  setActiveProfile,
  saveAuthProfile,
  type AuthProfile,
  type AuthProfiles
} from '../../../config/index.js';

export { AUTH_PROVIDERS, getProvider, setActiveProfile, saveAuthProfile };
export type { AuthProfile, AuthProfiles };

export function readProfiles(): { profiles: AuthProfiles; activeId: string | null } {
  const profiles = loadAuthProfiles();
  const activeId = getActiveProfile();
  return { profiles, activeId };
}

export function requireActiveProfile(): { id: string; profile: AuthProfile } {
  const { profiles, activeId } = readProfiles();
  if (!activeId) {
    throw new Error('No active profile found. Run: copilot profile login');
  }
  const profile = profiles[activeId];
  if (!profile) {
    throw new Error('Active profile is missing or corrupted. Run: copilot profile login');
  }
  return { id: activeId, profile };
}
