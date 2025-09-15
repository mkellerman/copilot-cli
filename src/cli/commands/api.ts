import path from 'path';
import { fileURLToPath } from 'url';
import { ProcessManager } from '../../core/process-manager.js';
import { ConfigManager } from '../../core/config-manager.js';
import { loadToken } from '../../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function start(options: {
  port?: number;
  host?: string;
  token?: string;
  background?: boolean;
  debug?: boolean;
}): Promise<void> {
  const pm = ProcessManager.getInstance();
  const config = ConfigManager.getInstance();
  
  if (pm.isRunning('api')) {
    console.error('API server is already running');
    console.log('Use: copilot-cli api restart');
    process.exit(1);
  }
  
  const port = options.port || config.get('api.port') || 3000;
  const host = options.host || config.get('api.host') || 'localhost';
  const debug = options.debug || config.get('debug') || false;
  
  const storedToken = loadToken();
  const token = options.token || storedToken;
  
  if (!token) {
    console.error('Error: No authentication token found');
    console.error('Run: copilot-cli auth login');
    process.exit(1);
  }
  
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: port.toString(),
    HOST: host,
    DEBUG: debug ? 'true' : 'false'
  };
  
  if (options.background) {
    const serverPath = path.join(__dirname, '../../../dist/api/standalone.js');
    await pm.startService('api', 'node', [serverPath], env, { port });
    console.log(`✓ API server started in background on ${host}:${port}`);
  } else {
    // Run in foreground
    const { spawn } = await import('child_process');
    const serverPath = path.join(__dirname, '../../../dist/api/standalone.js');
    
    console.log(`Starting API server on ${host}:${port}...`);
    console.log(`Token: ${token.substring(0, 10)}...${token.slice(-4)}`);
    
    const child = spawn('node', [serverPath], {
      env,
      stdio: 'inherit'
    });
    
    child.on('error', (error) => {
      console.error('Failed to start server:', error.message);
      process.exit(1);
    });
    
    process.on('SIGINT', () => {
      child.kill('SIGINT');
      process.exit(0);
    });
  }
}

export function stop(): void {
  const pm = ProcessManager.getInstance();
  
  if (pm.stopService('api')) {
    console.log('✓ API server stopped');
  } else {
    console.log('API server is not running');
  }
}

export async function restart(options: {
  port?: number;
  host?: string;
  token?: string;
  background?: boolean;
  debug?: boolean;
}): Promise<void> {
  const pm = ProcessManager.getInstance();
  const config = ConfigManager.getInstance();
  
  const port = options.port || config.get('api.port') || 3000;
  const host = options.host || config.get('api.host') || 'localhost';
  const debug = options.debug || config.get('debug') || false;
  
  const storedToken = loadToken();
  const token = options.token || storedToken;
  
  if (!token) {
    console.error('Error: No authentication token found');
    process.exit(1);
  }
  
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: port.toString(),
    HOST: host,
    DEBUG: debug ? 'true' : 'false'
  };
  
  console.log('Restarting API server...');
  const serverPath = path.join(__dirname, '../../../dist/api/standalone.js');
  await pm.restartService('api', 'node', [serverPath], env, { port });
  console.log(`✓ API server restarted on ${host}:${port}`);
}

export function status(): void {
  const pm = ProcessManager.getInstance();
  const info = pm.getServiceInfo('api');
  
  if (info) {
    const uptime = pm.getUptime('api');
    console.log(`API Server: ✓ Running`);
    console.log(`  Port: ${info.port || 'unknown'}`);
    console.log(`  PID: ${info.pid}`);
    console.log(`  Uptime: ${uptime}`);
  } else {
    console.log('API Server: ✗ Stopped');
  }
}