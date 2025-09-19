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
  debug: z.boolean()
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
  debug: false
};

export type ConfigPath =
  | 'api.port'
  | 'api.host'
  | 'model.default'
  | 'model.refreshIntervalMinutes'
  | 'catalog.ttlMinutes'
  | 'catalog.staleMinutes'
  | 'debug';

export const CONFIG_PATHS: ConfigPath[] = [
  'api.port',
  'api.host',
  'model.default',
  'model.refreshIntervalMinutes',
  'catalog.ttlMinutes',
  'catalog.staleMinutes',
  'debug'
];
