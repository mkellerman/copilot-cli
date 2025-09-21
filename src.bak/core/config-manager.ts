import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { CONFIG_DIR, ensureConfigDir } from '../config/index.js';
import { ConfigSchema, DEFAULT_CONFIG, type AppConfig, type ConfigPath } from '../config/schema.js';

const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface ConfigIssue {
  source: 'file' | 'environment';
  path?: string;
  message: string;
  value?: unknown;
}

export interface ConfigDoctorReport {
  ok: boolean;
  issues: ConfigIssue[];
  config: AppConfig;
  sources: {
    defaults: AppConfig;
    file: Partial<AppConfig>;
    environment: Partial<AppConfig>;
  };
}

export class ConfigManager {
  private static instance: ConfigManager | undefined;

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  private fileConfig: Record<string, any> = {};
  private envOverrides: Record<string, any> = {};
  private issues: ConfigIssue[] = [];
  private effectiveConfig: AppConfig = DEFAULT_CONFIG;

  private constructor() {
    this.reload();
  }

  get<T = unknown>(path: ConfigPath): T {
    return getFromPath(this.effectiveConfig, path) as T;
  }

  list(): AppConfig {
    return this.effectiveConfig;
  }

  async set(path: ConfigPath, value: unknown): Promise<void> {
    const normalized = normalizeValue(path, value);
    const nextFileConfig = setOnPath(this.fileConfig, path, normalized);
    const merged = mergeConfigs(DEFAULT_CONFIG, nextFileConfig, this.envOverrides);
    const parsed = ConfigSchema.safeParse(merged);
    if (!parsed.success) {
      const issue = formatZodError(path, parsed.error);
      throw new Error(issue);
    }

    this.fileConfig = nextFileConfig;
    this.effectiveConfig = parsed.data;
    this.persistFileConfig();
  }

  async reset(): Promise<void> {
    this.fileConfig = {};
    this.effectiveConfig = mergeConfigs(DEFAULT_CONFIG);
    this.persistFileConfig();
  }

  doctor(): ConfigDoctorReport {
    this.reload();
    return {
      ok: this.issues.length === 0,
      issues: [...this.issues],
      config: this.effectiveConfig,
      sources: {
        defaults: DEFAULT_CONFIG,
        file: this.fileConfig,
        environment: this.envOverrides
      }
    };
  }

  private reload(): void {
    ensureConfigDir();
    const fileResult = this.readFileConfig();
    const envResult = this.readEnvOverrides();

    this.fileConfig = fileResult.data;
    this.envOverrides = envResult.data;

    const merged = mergeConfigs(DEFAULT_CONFIG, this.fileConfig, this.envOverrides);
    const parsed = ConfigSchema.safeParse(merged);

    this.issues = [...fileResult.issues, ...envResult.issues];

    if (!parsed.success) {
      const formatted = parsed.error.errors.map((err) => err.message).join('; ');
      this.issues.push({
        source: 'file',
        message: `Configuration invalid: ${formatted}`
      });
      this.effectiveConfig = DEFAULT_CONFIG;
      return;
    }

    this.effectiveConfig = parsed.data;
  }

  private readFileConfig(): { data: Record<string, any>; issues: ConfigIssue[] } {
    if (!fs.existsSync(CONFIG_FILE)) {
      return { data: {}, issues: [] };
    }

    try {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      const json = JSON.parse(raw);
      if (typeof json !== 'object' || json === null) {
        return {
          data: {},
        issues: [{ source: 'file', message: 'Configuration file must be an object' }]
        };
      }

      const unknownKeys = collectUnknownKeys(json, ConfigSchema);
      const parsed = ConfigSchema.deepPartial().safeParse(json);

      const issues: ConfigIssue[] = unknownKeys.map((path) => ({
        source: 'file',
        path,
        message: 'Unknown configuration key'
      }));

      if (!parsed.success) {
        parsed.error.errors.forEach((issue) => {
          issues.push({
            source: 'file',
            path: issue.path.join('.') || undefined,
            message: issue.message
          });
        });
        return { data: {}, issues };
      }

      return { data: parsed.data as Record<string, any>, issues };
    } catch (error: any) {
      return {
        data: {},
        issues: [{ source: 'file', message: `Failed to parse configuration: ${error.message || error}` }]
      };
    }
  }

  private readEnvOverrides(): { data: Record<string, any>; issues: ConfigIssue[] } {
    let overrides: Record<string, any> = {};
    const issues: ConfigIssue[] = [];

    for (const [envVar, mapping] of Object.entries(ENVIRONMENT_MAP)) {
      const raw = process.env[envVar];
      if (raw === undefined) continue;

      try {
        const parsedValue = mapping.parse(raw);
        overrides = setOnPath(overrides, mapping.path, parsedValue);
      } catch (error: any) {
        issues.push({
          source: 'environment',
          path: mapping.path,
          message: error.message || String(error),
          value: raw
        });
      }
    }

    return { data: overrides, issues };
  }

  private persistFileConfig(): void {
    ensureConfigDir();
    const compact = removeDefaults(this.fileConfig, DEFAULT_CONFIG);
    if (Object.keys(compact).length === 0) {
      if (fs.existsSync(CONFIG_FILE)) {
        fs.unlinkSync(CONFIG_FILE);
      }
      return;
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(compact, null, 2));
  }
}

const ENVIRONMENT_MAP: Record<string, { path: ConfigPath; parse: (value: string) => unknown }> = {
  COPILOT_API_PORT: { path: 'api.port', parse: parseInteger('API port') },
  COPILOT_API_HOST: { path: 'api.host', parse: (value) => value },
  COPILOT_MODEL_DEFAULT: { path: 'model.default', parse: (value) => value },
  COPILOT_MODEL_REFRESH_MINUTES: { path: 'model.refreshIntervalMinutes', parse: parseInteger('Model refresh minutes') },
  COPILOT_CATALOG_TTL_MINUTES: { path: 'catalog.ttlMinutes', parse: parseInteger('Catalog TTL minutes') },
  COPILOT_CATALOG_STALE_MINUTES: { path: 'catalog.staleMinutes', parse: parseInteger('Catalog stale minutes') },
  COPILOT_DEBUG: { path: 'debug', parse: parseBoolean }
};

function mergeConfigs(...sources: Array<Record<string, any> | undefined>): AppConfig {
  const result: any = {};
  for (const source of sources) {
    if (!source) continue;
    mergeInto(result, source);
  }
  return result as AppConfig;
}

function mergeInto(target: any, source: any): void {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (isPlainObject(value)) {
      if (!isPlainObject(target[key])) {
        target[key] = {};
      }
      mergeInto(target[key], value);
    } else {
      target[key] = value;
    }
  }
}

function setOnPath(base: any, path: string | ConfigPath, value: unknown): Record<string, any> {
  const segments = path.toString().split('.');
  const clone = cloneObject(base ?? {});
  let cursor = clone;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (i === segments.length - 1) {
      cursor[segment] = value;
    } else {
      cursor[segment] = isPlainObject(cursor[segment]) ? { ...cursor[segment] } : {};
      cursor = cursor[segment];
    }
  }
  return clone;
}

function getFromPath(source: any, path: string | ConfigPath): unknown {
  return path.toString().split('.').reduce((acc: any, part) => {
    if (acc && typeof acc === 'object') {
      return acc[part];
    }
    return undefined;
  }, source);
}

function cloneObject<T>(value: T): T {
  return value && Object.keys(value as any).length > 0 ? JSON.parse(JSON.stringify(value)) : ({} as T);
}

function removeDefaults(partial: Record<string, any>, defaults: AppConfig): Record<string, any> {
  const result: any = {};
  for (const [key, value] of Object.entries(partial)) {
    if (value === undefined) continue;
    if (isPlainObject(value) && isPlainObject(defaults[key as keyof AppConfig])) {
      const nested = removeDefaults(value as any, defaults[key as keyof AppConfig] as any);
      if (Object.keys(nested).length > 0) {
        result[key] = nested;
      }
    } else if (value !== (defaults as any)[key]) {
      result[key] = value;
    }
  }
  return result;
}

function isPlainObject(value: any): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseInteger(label: string) {
  return (value: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      throw new Error(`${label} must be an integer`);
    }
    return parsed;
  };
}

function parseBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  throw new Error('Expected boolean value (true/false)');
}

function normalizeValue(path: ConfigPath, value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  switch (path) {
    case 'api.port':
    case 'model.refreshIntervalMinutes':
    case 'catalog.ttlMinutes':
    case 'catalog.staleMinutes':
      return parseInteger(path)(value);
    case 'debug':
      return parseBoolean(value);
    default:
      return value;
  }
}

function formatZodError(path: string, error: z.ZodError<any>): string {
  const issue = error.errors[0];
  const field = issue.path.join('.') || path;
  return `${field}: ${issue.message}`;
}

function collectUnknownKeys(value: unknown, schema: z.ZodTypeAny, prefix = ''): string[] {
  if (!(schema instanceof z.ZodObject) || !isPlainObject(value)) {
    return [];
  }

  const shape = schema.shape;
  const unknown: string[] = [];

  for (const key of Object.keys(value)) {
    const currentPath = prefix ? `${prefix}.${key}` : key;
    const childSchema = (shape as any)[key];
    if (!childSchema) {
      unknown.push(currentPath);
      continue;
    }
    unknown.push(...collectUnknownKeys((value as any)[key], childSchema, currentPath));
  }
  return unknown;
}
