import fs from 'node:fs';
import path from 'node:path';
import { ensureConfigDir, CONFIG_DIR } from '../config/index.js';
import { CopilotHttpClient, type CopilotModel } from './copilot-client.js';
import { ConfigManager } from './config-manager.js';

const CATALOG_VERSION = 1;
const DEFAULT_VERIFY_CONCURRENCY = 3;
const CATALOG_FILE = path.join(CONFIG_DIR, 'model-catalog.json');

type CatalogStatus = 'ready' | 'stale' | 'error';

interface CatalogStats {
  total: number;
  working: number;
  failed: number;
  durationMs: number;
  validated: boolean;
}

interface StoredModelCatalogEntry {
  profileId: string;
  updatedAt: number;
  lastAttemptAt: number;
  ttlMs: number;
  models: string[];
  rawModels: CopilotModel[];
  status: 'ready' | 'error';
  source: 'manual' | 'scheduled';
  stats: CatalogStats;
  failedModels?: string[];
  error?: string;
}

interface ModelCatalogState {
  version: number;
  updatedAt: number;
  entries: Record<string, StoredModelCatalogEntry>;
}

export interface ModelCatalogEntry {
  profileId: string;
  updatedAt: number;
  expiresAt: number;
  ttlMs: number;
  ageMs: number;
  status: CatalogStatus;
  models: string[];
  rawModels: CopilotModel[];
  failedModels?: string[];
  stats: CatalogStats;
  source: 'manual' | 'scheduled';
  error?: string;
}

export interface ModelValidationProgress {
  modelId: string;
  success: boolean;
  index: number;
  total: number;
}

export interface RefreshOptions {
  profileId: string;
  token: string;
  verify?: boolean;
  source?: 'manual' | 'scheduled';
  ttlMs?: number;
  signal?: AbortSignal;
  concurrency?: number;
  onProgress?: (progress: ModelValidationProgress) => void;
}

export interface EnsureOptions {
  staleAfterMs?: number;
  verify?: boolean;
  source?: 'manual' | 'scheduled';
  ttlMs?: number;
  signal?: AbortSignal;
  concurrency?: number;
  onProgress?: (progress: ModelValidationProgress) => void;
}

export class ModelCatalog {
  private static instance: ModelCatalog | undefined;

  static getInstance(): ModelCatalog {
    if (!ModelCatalog.instance) {
      ModelCatalog.instance = new ModelCatalog();
    }
    return ModelCatalog.instance;
  }

  private readonly filePath = CATALOG_FILE;
  private readonly client = CopilotHttpClient.getInstance();
  private readonly inflight = new Map<string, Promise<ModelCatalogEntry>>();
  private state: ModelCatalogState;
  private readonly defaultTtlMs: number;
  private readonly defaultStaleMs: number;
  private readonly defaultConcurrency = DEFAULT_VERIFY_CONCURRENCY;

  private constructor() {
    this.state = this.loadState();
    const config = ConfigManager.getInstance();
    const ttlMinutes = config.get<number>('catalog.ttlMinutes');
    const staleMinutes = config.get<number>('catalog.staleMinutes');
    this.defaultTtlMs = minutesToMs(ttlMinutes);
    this.defaultStaleMs = minutesToMs(staleMinutes);
  }

  getEntry(profileId: string): ModelCatalogEntry | undefined {
    const stored = this.state.entries[profileId];
    if (!stored) {
      return undefined;
    }
    return this.materializeEntry(stored);
  }

  getAllEntries(): ModelCatalogEntry[] {
    return Object.values(this.state.entries).map((entry) => this.materializeEntry(entry));
  }

  async refresh(options: RefreshOptions): Promise<ModelCatalogEntry> {
    const { profileId } = options;

    if (this.inflight.has(profileId)) {
      return this.inflight.get(profileId)!;
    }

    const refreshPromise = this.performRefresh(options)
      .finally(() => {
        this.inflight.delete(profileId);
      });

    this.inflight.set(profileId, refreshPromise);
    return refreshPromise;
  }

  async ensureFreshProfile(profileId: string, token: string, options: EnsureOptions = {}): Promise<ModelCatalogEntry> {
    const existing = this.getEntry(profileId);
    if (existing) {
      const staleAfterMs = options.staleAfterMs ?? this.defaultStaleMs;
      const isStale = existing.status === 'error' || existing.ageMs > staleAfterMs;
      if (!isStale) {
        return existing;
      }
    }

    return this.refresh({
      profileId,
      token,
      verify: options.verify,
      source: options.source,
      ttlMs: options.ttlMs,
      signal: options.signal,
      concurrency: options.concurrency,
      onProgress: options.onProgress
    });
  }

  clear(profileId?: string): void {
    if (profileId) {
      delete this.state.entries[profileId];
    } else {
      this.state.entries = {};
    }
    this.persist();
  }

  private async performRefresh(options: RefreshOptions): Promise<ModelCatalogEntry> {
    const {
      profileId,
      token,
      verify = true,
      source = 'manual',
      ttlMs = this.defaultTtlMs,
      signal,
      concurrency,
      onProgress
    } = options;

    const startedAt = Date.now();

    try {
      if (signal?.aborted) {
        throw this.asError(signal.reason) ?? new Error('Model refresh aborted');
      }

      const rawModels = await this.client.listModels(token);
      const ids = rawModels.map((model) => model.id).filter(Boolean);

      let workingModels = [...ids];
      let failedModels: string[] = [];
      let validated = false;

      if (verify && ids.length > 0) {
        const validation = await this.verifyModels(token, ids, {
          signal,
          concurrency,
          onProgress
        });
        workingModels = validation.working;
        failedModels = validation.failed;
        validated = true;
      }

      const completedAt = Date.now();

      const stored: StoredModelCatalogEntry = {
        profileId,
        updatedAt: completedAt,
        lastAttemptAt: completedAt,
        ttlMs,
        models: workingModels,
        rawModels,
        status: 'ready',
        source,
        stats: {
          total: ids.length,
          working: workingModels.length,
          failed: failedModels.length,
          durationMs: completedAt - startedAt,
          validated
        },
        failedModels: failedModels.length ? failedModels : undefined,
        error: undefined
      };

      this.state.entries[profileId] = stored;
      this.persist();
      return this.materializeEntry(stored);
    } catch (error) {
      const completedAt = Date.now();
      const stored: StoredModelCatalogEntry = {
        profileId,
        updatedAt: completedAt,
        lastAttemptAt: completedAt,
        ttlMs,
        models: [],
        rawModels: [],
        status: 'error',
        source,
        stats: {
          total: 0,
          working: 0,
          failed: 0,
          durationMs: completedAt - startedAt,
          validated: false
        },
        failedModels: undefined,
        error: error instanceof Error ? error.message : String(error)
      };

      this.state.entries[profileId] = stored;
      this.persist();
      throw error;
    }
  }

  private async verifyModels(
    token: string,
    modelIds: string[],
    options: { signal?: AbortSignal; concurrency?: number; onProgress?: (progress: ModelValidationProgress) => void }
  ): Promise<{ working: string[]; failed: string[]; total: number }> {
    const { signal, concurrency = this.defaultConcurrency, onProgress } = options;
    const working: string[] = [];
    const failed: string[] = [];
    const total = modelIds.length;

    if (total === 0) {
      return { working, failed, total };
    }

    let cursor = 0;
    const effectiveConcurrency = Math.max(1, Math.min(concurrency, total));

    const run = async () => {
      while (true) {
        const currentIndex = cursor++;
        if (currentIndex >= total) {
          break;
        }

        if (signal?.aborted) {
          throw this.asError(signal.reason) ?? new Error('Model validation aborted');
        }

        const modelId = modelIds[currentIndex];
        const success = await this.client.verifyModel(token, modelId, { signal });
        if (success) {
          working.push(modelId);
        } else {
          failed.push(modelId);
        }

        onProgress?.({
          modelId,
          success,
          index: currentIndex + 1,
          total
        });
      }
    };

    await Promise.all(Array.from({ length: effectiveConcurrency }, () => run()));

    return { working, failed, total };
  }

  private materializeEntry(entry: StoredModelCatalogEntry): ModelCatalogEntry {
    const now = Date.now();
    const expiresAt = entry.updatedAt + entry.ttlMs;
    const ageMs = now - entry.updatedAt;
    let status: CatalogStatus;

    if (entry.status === 'error') {
      status = 'error';
    } else if (now > expiresAt) {
      status = 'stale';
    } else {
      status = 'ready';
    }

    return {
      profileId: entry.profileId,
      updatedAt: entry.updatedAt,
      expiresAt,
      ttlMs: entry.ttlMs,
      ageMs,
      status,
      models: [...entry.models],
      rawModels: entry.rawModels.map((model) => ({ ...model })),
      failedModels: entry.failedModels ? [...entry.failedModels] : undefined,
      stats: { ...entry.stats },
      source: entry.source,
      error: entry.error
    };
  }

  private loadState(): ModelCatalogState {
    if (!fs.existsSync(this.filePath)) {
      return {
        version: CATALOG_VERSION,
        updatedAt: 0,
        entries: {}
      };
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<ModelCatalogState>;
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid catalog state');
      }

      return {
        version: parsed.version ?? CATALOG_VERSION,
        updatedAt: parsed.updatedAt ?? 0,
        entries: parsed.entries ?? {}
      };
    } catch {
      return {
        version: CATALOG_VERSION,
        updatedAt: 0,
        entries: {}
      };
    }
  }

  private persist(): void {
    ensureConfigDir();
    const payload: ModelCatalogState = {
      version: CATALOG_VERSION,
      updatedAt: Date.now(),
      entries: this.state.entries
    };
    fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf8');
  }

  private asError(reason: unknown): Error | null {
    if (!reason) {
      return null;
    }
    if (reason instanceof Error) {
      return reason;
    }
    if (typeof reason === 'string') {
      return new Error(reason);
    }
    return new Error(String(reason));
  }
}

function minutesToMs(minutes: number): number {
  return Math.max(1, minutes) * 60_000;
}
