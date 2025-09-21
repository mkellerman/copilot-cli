import fs from 'node:fs';
import path from 'node:path';

let level = (() => {
  const raw = process.env.COPILOT_VERBOSE || '';
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(3, n)) : 0;
})();

let logFilePath: string | undefined = process.env.COPILOT_LOG_FILE || undefined;
let wroteHeader = false;

export function setLevel(n: number) {
  level = Math.max(0, Math.min(3, Math.floor(n)));
}

export function getLevel(): number {
  return level;
}

export function setLogFile(filePath: string | undefined) {
  logFilePath = filePath;
  wroteHeader = false;
}

function ts(): string {
  return new Date().toISOString();
}

export function log(lvl: number, tag: string, msg: string, extra?: any) {
  if (level < lvl) return;
  const prefix = `[${ts()}] [${tag}]`;
  const line = formatLine(prefix, msg, extra);
  console.log(line);
  writeToFile(line);
}

export function warn(tag: string, msg: string, extra?: any) {
  const prefix = `[${ts()}] [${tag}]`;
  const line = formatLine(prefix, msg, extra);
  console.warn(line);
  writeToFile(line);
}

export function error(tag: string, msg: string, extra?: any) {
  const prefix = `[${ts()}] [${tag}]`;
  const line = formatLine(prefix, msg, extra);
  console.error(line);
  writeToFile(line);
}

export function safeStringify(obj: any, maxBytes: number = 2048): string {
  const json = typeof obj === 'string' ? obj : JSON.stringify(obj, redactReplacer, 2);
  if (Buffer.byteLength(json, 'utf8') <= maxBytes) return json;
  // Truncate preserving JSON-ish readability
  const slice = Buffer.from(json, 'utf8').subarray(0, maxBytes).toString('utf8');
  return slice + '\n…(truncated)…';
}

function redactReplacer(this: any, key: string, value: any) {
  const k = key.toLowerCase();
  if (k === 'authorization' || k === 'auth' || k.endsWith('token') || k.endsWith('api_key') || k.includes('secret')) {
    if (typeof value === 'string' && value.length > 8) {
      return value.slice(0, 4) + '…' + value.slice(-4);
    }
    return '[redacted]';
  }
  return value;
}

export function redactHeaders(headers: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (lower === 'authorization') {
      out[k] = '[redacted]';
    } else {
      out[k] = v;
    }
  }
  return out;
}

function formatLine(prefix: string, msg: string, extra?: any): string {
  if (extra === undefined) return `${prefix} ${msg}`;
  let serialized: string;
  try {
    serialized = safeStringify(extra);
  } catch {
    serialized = '';
  }
  return serialized ? `${prefix} ${msg} ${serialized}` : `${prefix} ${msg}`;
}

function writeToFile(line: string) {
  if (!logFilePath) return;
  try {
    const dir = path.dirname(logFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!wroteHeader) {
      const header = `# copilot verbose log\n# started: ${new Date().toISOString()}\n`;
      fs.appendFileSync(logFilePath, header, 'utf8');
      wroteHeader = true;
    }
    fs.appendFileSync(logFilePath, line + '\n', 'utf8');
  } catch {
    // ignore file write errors to avoid breaking runtime
  }
}
