import { startApiServer } from './server.js';
import { DEFAULT_PORT, loadAuthInfo, loadToken } from '../config/index.js';

const port = Number(process.env.PORT) || DEFAULT_PORT;
const host = process.env.HOST || undefined;
const authInfo = loadAuthInfo();
const token = authInfo?.token || loadToken();

if (!token) {
  console.error('Error: Not authenticated');
  console.error('Run: copilot profile login');
  process.exit(1);
}

startApiServer(port, token, host);
