import fs from 'fs';
import path from 'path';
import os from 'os';

export const CONFIG_DIR = path.join(os.homedir(), '.copilot-cli');
export const TOKEN_FILE = path.join(CONFIG_DIR, 'token');
export const AUTH_FILE = path.join(CONFIG_DIR, 'auth.json');
export const PROFILES_FILE = path.join(CONFIG_DIR, 'profiles.json');
export const ACTIVE_PROFILE_FILE = path.join(CONFIG_DIR, 'active-profile');
export const DEFAULT_PORT = 3000;
export const DEFAULT_OSS_PORT = 11434;
export const COPILOT_HOST = 'api.githubcopilot.com';

export interface AuthInfo {
  token: string;
  provider: string;
  timestamp: number;
  models?: string[];
}

export interface AuthProfile {
  id: string;
  token: string;
  githubToken: string;
  provider: string;
  timestamp: number;
  models?: string[];
  user: {
    id: number;
    login: string;
    name: string | null;
    email: string | null;
    avatar_url: string;
  };
}

export interface AuthProfiles {
  [profileId: string]: AuthProfile;
}

export function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function saveToken(token: string): void {
  ensureConfigDir();
  fs.writeFileSync(TOKEN_FILE, token, 'utf8');
  fs.chmodSync(TOKEN_FILE, 0o600);
}

export function saveAuthInfo(info: AuthInfo): void {
  ensureConfigDir();
  fs.writeFileSync(AUTH_FILE, JSON.stringify(info, null, 2), 'utf8');
  fs.chmodSync(AUTH_FILE, 0o600);
  // Also save token for backwards compatibility
  saveToken(info.token);
}

export function loadAuthInfo(): AuthInfo | null {
  // Try to migrate old auth first
  migrateOldAuth();
  
  // Use active profile if available
  const activeProfileId = getActiveProfile();
  if (activeProfileId) {
    const profiles = loadAuthProfiles();
    const profile = profiles[activeProfileId];
    if (profile) {
      return {
        token: profile.token,
        provider: profile.provider,
        timestamp: profile.timestamp,
        models: profile.models
      };
    }
  }
  
  // Fallback to old auth file
  if (fs.existsSync(AUTH_FILE)) {
    try {
      const data = fs.readFileSync(AUTH_FILE, 'utf8');
      return JSON.parse(data);
    } catch {
      // Fall back to just token
    }
  }
  
  // Try legacy token file
  const token = loadToken();
  if (token) {
    return {
      token,
      provider: 'unknown',
      timestamp: Date.now()
    };
  }
  
  return null;
}

export function loadToken(): string | null {
  if (fs.existsSync(TOKEN_FILE)) {
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  }
  return null;
}

export function deleteToken(): boolean {
  let deleted = false;
  if (fs.existsSync(TOKEN_FILE)) {
    fs.unlinkSync(TOKEN_FILE);
    deleted = true;
  }
  if (fs.existsSync(AUTH_FILE)) {
    fs.unlinkSync(AUTH_FILE);
    deleted = true;
  }
  return deleted;
}

// Profile management functions
export function loadAuthProfiles(): AuthProfiles {
  if (fs.existsSync(PROFILES_FILE)) {
    try {
      const data = fs.readFileSync(PROFILES_FILE, 'utf8');
      return JSON.parse(data);
    } catch {
      return {};
    }
  }
  return {};
}

export function saveAuthProfiles(profiles: AuthProfiles): void {
  ensureConfigDir();
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2), 'utf8');
  fs.chmodSync(PROFILES_FILE, 0o600);
}

export function saveAuthProfile(profileId: string, profile: AuthProfile): void {
  const profiles = loadAuthProfiles();
  profiles[profileId] = profile;
  saveAuthProfiles(profiles);
  
  // Maintain backwards compatibility
  if (getActiveProfile() === profileId) {
    saveAuthInfo({
      token: profile.token,
      provider: profile.provider,
      timestamp: profile.timestamp,
      models: profile.models
    });
  }
}

export function getActiveProfile(): string | null {
  if (fs.existsSync(ACTIVE_PROFILE_FILE)) {
    try {
      return fs.readFileSync(ACTIVE_PROFILE_FILE, 'utf8').trim();
    } catch {
      return null;
    }
  }
  
  // Check if we have any profiles and auto-select if only one
  const profiles = loadAuthProfiles();
  const profileIds = Object.keys(profiles);
  if (profileIds.length === 1) {
    setActiveProfile(profileIds[0]);
    return profileIds[0];
  }
  
  return null;
}

export function setActiveProfile(profileId: string): void {
  ensureConfigDir();
  fs.writeFileSync(ACTIVE_PROFILE_FILE, profileId, 'utf8');
  fs.chmodSync(ACTIVE_PROFILE_FILE, 0o600);
  
  // Update backwards compatibility files
  const profiles = loadAuthProfiles();
  const profile = profiles[profileId];
  if (profile) {
    saveAuthInfo({
      token: profile.token,
      provider: profile.provider,
      timestamp: profile.timestamp,
      models: profile.models
    });
  }
}

export function generateProfileId(provider: string, userLogin: string): string {
  return `${provider}-${userLogin}`;
}

export function deleteAuthProfile(profileId: string): boolean {
  const profiles = loadAuthProfiles();
  if (profiles[profileId]) {
    delete profiles[profileId];
    saveAuthProfiles(profiles);
    
    // If this was the active profile, clear it
    const activeProfile = getActiveProfile();
    if (activeProfile === profileId) {
      if (fs.existsSync(ACTIVE_PROFILE_FILE)) {
        fs.unlinkSync(ACTIVE_PROFILE_FILE);
      }
      
      // Auto-select another profile if available
      const remainingProfiles = Object.keys(profiles);
      if (remainingProfiles.length > 0) {
        setActiveProfile(remainingProfiles[0]);
      }
    }
    
    return true;
  }
  return false;
}

export interface ServerConfig {
  port: number;
  debug: boolean;
  token?: string;
}

// Migration function to convert old auth to new profile system
export function migrateOldAuth(): void {
  // Load auth info directly to avoid recursion
  let oldAuthInfo: AuthInfo | null = null;
  if (fs.existsSync(AUTH_FILE)) {
    try {
      const data = fs.readFileSync(AUTH_FILE, 'utf8');
      oldAuthInfo = JSON.parse(data);
    } catch {
      // Ignore parse errors
    }
  }
  
  const profiles = loadAuthProfiles();
  
  // Only migrate if we have old auth but no profiles
  if (oldAuthInfo && Object.keys(profiles).length === 0) {
    const profileId = generateProfileId(oldAuthInfo.provider, 'unknown');
    const profile: AuthProfile = {
      id: profileId,
      token: oldAuthInfo.token,
      githubToken: oldAuthInfo.token, // Fallback
      provider: oldAuthInfo.provider,
      timestamp: oldAuthInfo.timestamp,
      models: oldAuthInfo.models,
      user: {
        id: 0,
        login: 'unknown',
        name: null,
        email: null,
        avatar_url: ''
      }
    };
    
    saveAuthProfile(profileId, profile);
    setActiveProfile(profileId);
  }
}
