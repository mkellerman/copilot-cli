import type { Request } from 'express';
import { loadAuthProfiles } from '../../config/index.js';

export function resolveActiveToken(req: Request, fallback?: string | null): string | null {
  const authHeader = req.headers.authorization;
  let activeToken = fallback || null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const providedToken = authHeader.substring(7);
    if (providedToken.startsWith('ghu_') || providedToken.startsWith('ghp_')) {
      activeToken = providedToken;
    }
  }

  return activeToken;
}

export function resolveProfileIdForToken(token?: string): string | undefined {
  if (!token) {
    return undefined;
  }

  const profiles = loadAuthProfiles();
  for (const [profileId, profile] of Object.entries(profiles)) {
    if (profile.token === token) {
      return profileId;
    }
  }
  return undefined;
}

