import path from 'path';
import { fileURLToPath } from 'url';
import { ProcessManager } from '../../core/process-manager.js';
import { ConfigManager } from '../../core/config-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function start(options: {
  transport?: 'stdio' | 'tcp' | 'sse';
  port?: number;
  background?: boolean;
  debug?: boolean;
}): Promise<void> {
  const pm = ProcessManager.getInstance();
  const config = ConfigManager.getInstance();
  
  if (pm.isRunning('mcp')) {
    console.error('MCP server is already running');
    console.log('Use: copilot-cli mcp restart');
    process.exit(1);
  }
  
  const transport = options.transport || config.get('mcp.transport') || 'stdio';
  const port = options.port || config.get('mcp.port') || 9000;
  const debug = options.debug || config.get('debug') || false;
  
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MCP_TRANSPORT: transport,
    MCP_PORT: port.toString(),
    DEBUG: debug ? 'true' : 'false'
  };
  
  if (options.background || transport !== 'stdio') {
    const serverPath = path.join(__dirname, '../../../dist/mcp/index.js');
    await pm.startService('mcp', 'node', [serverPath], env, { port, transport });
    
    if (transport === 'stdio') {
      console.log(`✓ MCP server started in background (stdio)`);
    } else if (transport === 'tcp') {
      console.log(`✓ MCP server started in background (TCP on port ${port})`);
    } else if (transport === 'sse') {
      console.log(`✓ MCP server started in background (SSE on port ${port})`);
    }
  } else {
    // Run stdio in foreground
    const { spawn } = await import('child_process');
    const serverPath = path.join(__dirname, '../../../dist/mcp/index.js');
    
    console.log('Starting MCP server (stdio)...');
    
    const child = spawn('node', [serverPath], {
      env,
      stdio: 'inherit'
    });
    
    child.on('error', (error) => {
      console.error('Failed to start MCP server:', error.message);
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
  
  if (pm.stopService('mcp')) {
    console.log('✓ MCP server stopped');
  } else {
    console.log('MCP server is not running');
  }
}

export async function restart(options: {
  transport?: 'stdio' | 'tcp' | 'sse';
  port?: number;
  background?: boolean;
  debug?: boolean;
}): Promise<void> {
  const pm = ProcessManager.getInstance();
  const config = ConfigManager.getInstance();
  
  const transport = options.transport || config.get('mcp.transport') || 'stdio';
  const port = options.port || config.get('mcp.port') || 9000;
  const debug = options.debug || config.get('debug') || false;
  
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MCP_TRANSPORT: transport,
    MCP_PORT: port.toString(),
    DEBUG: debug ? 'true' : 'false'
  };
  
  console.log('Restarting MCP server...');
  const serverPath = path.join(__dirname, '../../../dist/mcp/index.js');
  await pm.restartService('mcp', 'node', [serverPath], env, { port, transport });
  
  if (transport === 'stdio') {
    console.log(`✓ MCP server restarted (stdio)`);
  } else if (transport === 'tcp') {
    console.log(`✓ MCP server restarted (TCP on port ${port})`);
  } else if (transport === 'sse') {
    console.log(`✓ MCP server restarted (SSE on port ${port})`);
  }
}

export function status(): void {
  const pm = ProcessManager.getInstance();
  const info = pm.getServiceInfo('mcp');
  
  if (info) {
    const uptime = pm.getUptime('mcp');
    console.log(`MCP Server: ✓ Running`);
    console.log(`  Transport: ${info.transport || 'unknown'}`);
    if (info.transport !== 'stdio') {
      console.log(`  Port: ${info.port || 'unknown'}`);
    }
    console.log(`  PID: ${info.pid}`);
    console.log(`  Uptime: ${uptime}`);
  } else {
    console.log('MCP Server: ✗ Stopped');
  }
}