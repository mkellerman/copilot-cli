import { ProcessManager } from '../../core/process-manager.js';
import { loadToken } from '../../config/index.js';

export function status(options: { json?: boolean; verbose?: boolean } = {}): void {
  const pm = ProcessManager.getInstance();
  const token = loadToken();
  
  const apiInfo = pm.getServiceInfo('api');
  const mcpInfo = pm.getServiceInfo('mcp');
  
  if (options.json) {
    const output = {
      authentication: {
        status: token ? 'active' : 'inactive',
        token: token ? `${token.substring(0, 10)}...${token.slice(-4)}` : null
      },
      services: {
        api: apiInfo ? {
          status: 'running',
          port: apiInfo.port,
          pid: apiInfo.pid,
          uptime: pm.getUptime('api'),
          startTime: apiInfo.startTime
        } : { status: 'stopped' },
        mcp: mcpInfo ? {
          status: 'running',
          transport: mcpInfo.transport,
          port: mcpInfo.port,
          pid: mcpInfo.pid,
          uptime: pm.getUptime('mcp'),
          startTime: mcpInfo.startTime
        } : { status: 'stopped' }
      }
    };
    
    console.log(JSON.stringify(output, null, 2));
  } else {
    // Authentication status
    if (token) {
      console.log(`Authentication: ✓ Active (token: ${token.substring(0, 10)}...${token.slice(-4)})`);
    } else {
      console.log('Authentication: ✗ Not authenticated');
    }
    
    console.log('\nServices:');
    
    // API Server status
    if (apiInfo) {
      const uptime = pm.getUptime('api');
      console.log(`  API Server:  ✓ Running (port ${apiInfo.port}, uptime: ${uptime})`);
      if (options.verbose) {
        console.log(`               PID: ${apiInfo.pid}`);
        console.log(`               Started: ${new Date(apiInfo.startTime).toLocaleString()}`);
      }
    } else {
      console.log('  API Server:  ✗ Stopped');
    }
    
    // MCP Server status
    if (mcpInfo) {
      const uptime = pm.getUptime('mcp');
      let details = mcpInfo.transport || 'stdio';
      if (mcpInfo.port && mcpInfo.transport !== 'stdio') {
        details += ` on port ${mcpInfo.port}`;
      }
      console.log(`  MCP Server:  ✓ Running (${details}, uptime: ${uptime})`);
      if (options.verbose) {
        console.log(`               PID: ${mcpInfo.pid}`);
        console.log(`               Started: ${new Date(mcpInfo.startTime).toLocaleString()}`);
      }
    } else {
      console.log('  MCP Server:  ✗ Stopped');
    }
    
    // Summary
    const runningCount = [apiInfo, mcpInfo].filter(Boolean).length;
    if (runningCount > 0) {
      console.log(`\nActive services: ${runningCount}`);
    }
  }
}