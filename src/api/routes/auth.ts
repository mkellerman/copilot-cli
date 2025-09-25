import type { Request } from 'express';
import { loadAuthInfo, loadAuthProfiles, loadToken } from '../../config/index.js';
import { getValidToken } from '../../core/auth.js';

let serverToken: string | null = null;
let refreshInFlight: Promise<string | null> | null = null;

function normalizeToken(token: string | null | undefined): string | null {
  if (typeof token !== 'string') {
    return null;
  }
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isCopilotToken(token: string | null | undefined): boolean {
  if (!token) return false;
  if (
    token.startsWith('ghu_') ||
    token.startsWith('ghp_') ||
    token.startsWith('ghs_') ||
    token.startsWith('gho_') ||
    token.startsWith('copilot_') ||
    token.startsWith('tid=')
  ) {
    return true;
  }
  if (token.startsWith('gh') && token.includes('_')) {
    return true;
  }
  return false;
}

function extractBearerToken(value: string | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('Bearer ')) return null;
  const raw = value.slice('Bearer '.length).trim();
  return isCopilotToken(raw) ? raw : null;
}

async function loadTokenFromConfig(): Promise<string | null> {
  const authInfo = loadAuthInfo();
  if (authInfo?.token && isCopilotToken(authInfo.token)) {
    serverToken = authInfo.token.trim();
    return serverToken;
  }

  const legacyToken = loadToken();
  if (legacyToken && isCopilotToken(legacyToken)) {
    serverToken = legacyToken.trim();
    return serverToken;
  }

  return null;
}

async function startRefresh(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const token = await getValidToken();
        if (token && isCopilotToken(token)) {
          serverToken = token.trim();
          return serverToken;
        }
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

export function primeServerToken(initial?: string | null): void {
  const normalized = normalizeToken(initial);
  if (normalized && isCopilotToken(normalized)) {
    serverToken = normalized;
  }
}

export async function refreshServerToken(): Promise<string | null> {
  return startRefresh();
}

export interface ResolveActiveTokenOptions {
  refreshIfMissing?: boolean;
}

export async function resolveActiveToken(
  req: Request,
  fallback?: string | null,
  options: ResolveActiveTokenOptions = {}
): Promise<string | null> {
  const headerToken = extractBearerToken(req.headers.authorization);
  if (headerToken) {
    return headerToken;
  }

  const normalizedFallback = normalizeToken(fallback);
  if (normalizedFallback && isCopilotToken(normalizedFallback)) {
    serverToken = normalizedFallback;
    return serverToken;
  }

  if (serverToken && isCopilotToken(serverToken)) {
    return serverToken;
  }

  const configToken = await loadTokenFromConfig();
  if (configToken) {
    return configToken;
  }

  if (options.refreshIfMissing) {
    return await startRefresh();
  }

  return null;
}

export async function getServerToken(options: { refreshIfMissing?: boolean } = {}): Promise<string | null> {
  if (serverToken && isCopilotToken(serverToken)) {
    return serverToken;
  }

  const configToken = await loadTokenFromConfig();
  if (configToken) {
    return configToken;
  }

  if (options.refreshIfMissing) {
    return await startRefresh();
  }

  return null;
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
