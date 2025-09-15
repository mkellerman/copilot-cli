import fs from 'fs';
import path from 'path';
import { CONFIG_DIR, ensureConfigDir } from '../config/index.js';

const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

interface Config {
  api: {
    port: number;
    host: string;
  };
  mcp: {
    transport: 'stdio' | 'tcp' | 'sse';
    port: number;
  };
  model: {
    default: string;
  };
  debug: boolean;
}

const DEFAULT_CONFIG: Config = {
  api: {
    port: 3000,
    host: 'localhost'
  },
  mcp: {
    transport: 'stdio',
    port: 9000
  },
  model: {
    default: 'gpt-4'
  },
  debug: false
};

export class ConfigManager {
  private static instance: ConfigManager;
  private config!: Config;
  
  private constructor() {
    this.load();
  }
  
  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }
  
  private load(): void {
    ensureConfigDir();
    
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const data = fs.readFileSync(CONFIG_FILE, 'utf8');
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(data) };
      } catch {
        this.config = { ...DEFAULT_CONFIG };
      }
    } else {
      this.config = { ...DEFAULT_CONFIG };
      this.save();
    }
  }
  
  private save(): void {
    ensureConfigDir();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
  }
  
  get(key: string): any {
    const keys = key.split('.');
    let value: any = this.config;
    
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return undefined;
      }
    }
    
    return value;
  }
  
  set(key: string, value: any): void {
    const keys = key.split('.');
    let obj: any = this.config;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!(k in obj) || typeof obj[k] !== 'object') {
        obj[k] = {};
      }
      obj = obj[k];
    }
    
    const lastKey = keys[keys.length - 1];
    
    // Type validation based on key
    if (key === 'api.port' || key === 'mcp.port') {
      value = parseInt(value);
      if (isNaN(value) || value < 1 || value > 65535) {
        throw new Error('Port must be between 1 and 65535');
      }
    } else if (key === 'mcp.transport') {
      if (!['stdio', 'tcp', 'sse'].includes(value)) {
        throw new Error('Transport must be stdio, tcp, or sse');
      }
    } else if (key === 'debug') {
      value = value === 'true' || value === true;
    }
    
    obj[lastKey] = value;
    this.save();
  }
  
  list(): Config {
    return { ...this.config };
  }
  
  reset(): void {
    this.config = { ...DEFAULT_CONFIG };
    this.save();
  }
}