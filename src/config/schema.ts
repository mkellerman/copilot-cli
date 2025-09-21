import { z } from 'zod';

export const ConfigSchema = z.object({
  api: z.object({
    port: z.coerce.number().int().min(1).max(65535),
    host: z.string().min(1)
  }),
  model: z.object({
    default: z.string().min(1),
    refreshIntervalMinutes: z.coerce.number().int().min(1).max(1440).default(30)
  }),
  catalog: z.object({
    ttlMinutes: z.coerce.number().int().min(1).max(1440).default(10),
    staleMinutes: z.coerce.number().int().min(1).max(2880).default(30)
  }).default({}),
  debug: z.boolean(),
  transforms: z.object({
    enabled: z.boolean().default(false),
    allowScripts: z.boolean().default(false),
    pipelines: z.object({
      'openai.chat.completions': z.array(z.string()).default([]),
      'anthropic.messages': z.array(z.string()).default([])
    }).partial().default({}),
    registry: z.record(z.string(), z.object({
      module: z.string().min(1),
      options: z.any().optional()
    })).default({})
  }).default({})
}).strict();

export type AppConfig = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: AppConfig = {
  api: {
    port: 3000,
    host: 'localhost'
  },
  model: {
    default: 'gpt-4',
    refreshIntervalMinutes: 30
  },
  catalog: {
    ttlMinutes: 10,
    staleMinutes: 30
  },
  debug: false,
  transforms: {
    enabled: false,
    allowScripts: false,
    pipelines: {
      'openai.chat.completions': [],
      'anthropic.messages': []
    },
    registry: {}
  }
};

export type ConfigPath =
  | 'api.port'
  | 'api.host'
  | 'model.default'
  | 'model.refreshIntervalMinutes'
  | 'catalog.ttlMinutes'
  | 'catalog.staleMinutes'
  | 'debug'
  | 'transforms.enabled'
  | 'transforms.allowScripts';

export const CONFIG_PATHS: ConfigPath[] = [
  'api.port',
  'api.host',
  'model.default',
  'model.refreshIntervalMinutes',
  'catalog.ttlMinutes',
  'catalog.staleMinutes',
  'debug',
  'transforms.enabled',
  'transforms.allowScripts'
];
