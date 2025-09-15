import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { CONFIG_DIR, ensureConfigDir } from '../config/index.js';

const PID_DIR = path.join(CONFIG_DIR, 'pids');
const LOG_DIR = path.join(CONFIG_DIR, 'logs');

interface ServiceInfo {
  pid: number;
  port?: number;
  transport?: string;
  startTime: number;
}

export class ProcessManager {
  private static instance: ProcessManager;
  
  private constructor() {
    this.ensureDirs();
  }
  
  static getInstance(): ProcessManager {
    if (!ProcessManager.instance) {
      ProcessManager.instance = new ProcessManager();
    }
    return ProcessManager.instance;
  }
  
  private ensureDirs(): void {
    ensureConfigDir();
    if (!fs.existsSync(PID_DIR)) {
      fs.mkdirSync(PID_DIR, { recursive: true });
    }
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  }
  
  private getPidFile(service: string): string {
    return path.join(PID_DIR, `${service}.json`);
  }
  
  private getLogFile(service: string): string {
    return path.join(LOG_DIR, `${service}.log`);
  }
  
  async startService(
    service: 'api' | 'mcp',
    command: string,
    args: string[],
    env?: NodeJS.ProcessEnv,
    options?: { port?: number; transport?: string }
  ): Promise<void> {
    if (this.isRunning(service)) {
      throw new Error(`${service} is already running`);
    }
    
    const logFile = this.getLogFile(service);
    const out = fs.openSync(logFile, 'a');
    const err = fs.openSync(logFile, 'a');
    
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      detached: true,
      stdio: ['ignore', out, err]
    });
    
    const serviceInfo: ServiceInfo = {
      pid: child.pid!,
      port: options?.port,
      transport: options?.transport,
      startTime: Date.now()
    };
    
    fs.writeFileSync(this.getPidFile(service), JSON.stringify(serviceInfo, null, 2));
    child.unref();
  }
  
  stopService(service: 'api' | 'mcp'): boolean {
    const pidFile = this.getPidFile(service);
    
    if (!fs.existsSync(pidFile)) {
      return false;
    }
    
    try {
      const info: ServiceInfo = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
      process.kill(info.pid, 'SIGTERM');
      fs.unlinkSync(pidFile);
      return true;
    } catch (error) {
      // Process might already be dead
      if (fs.existsSync(pidFile)) {
        fs.unlinkSync(pidFile);
      }
      return false;
    }
  }
  
  restartService(
    service: 'api' | 'mcp',
    command: string,
    args: string[],
    env?: NodeJS.ProcessEnv,
    options?: { port?: number; transport?: string }
  ): Promise<void> {
    this.stopService(service);
    // Wait a bit for the process to fully terminate
    return new Promise((resolve) => {
      setTimeout(async () => {
        await this.startService(service, command, args, env, options);
        resolve();
      }, 1000);
    });
  }
  
  isRunning(service: 'api' | 'mcp'): boolean {
    const pidFile = this.getPidFile(service);
    
    if (!fs.existsSync(pidFile)) {
      return false;
    }
    
    try {
      const info: ServiceInfo = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
      process.kill(info.pid, 0); // Check if process exists
      return true;
    } catch {
      // Process doesn't exist, clean up pid file
      fs.unlinkSync(pidFile);
      return false;
    }
  }
  
  getServiceInfo(service: 'api' | 'mcp'): ServiceInfo | null {
    const pidFile = this.getPidFile(service);
    
    if (!fs.existsSync(pidFile)) {
      return null;
    }
    
    try {
      const info: ServiceInfo = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
      // Verify process is still running
      process.kill(info.pid, 0);
      return info;
    } catch {
      // Process doesn't exist, clean up
      if (fs.existsSync(pidFile)) {
        fs.unlinkSync(pidFile);
      }
      return null;
    }
  }
  
  getAllServices(): { api?: ServiceInfo; mcp?: ServiceInfo } {
    return {
      api: this.getServiceInfo('api') || undefined,
      mcp: this.getServiceInfo('mcp') || undefined
    };
  }
  
  getUptime(service: 'api' | 'mcp'): string | null {
    const info = this.getServiceInfo(service);
    if (!info) return null;
    
    const uptimeMs = Date.now() - info.startTime;
    const hours = Math.floor(uptimeMs / (1000 * 60 * 60));
    const minutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }
}