import * as fs from 'fs';
import * as path from 'path';

const LOG_FILE = path.join(__dirname, '..', 'poll_debug.log');
fs.writeFileSync(LOG_FILE, `=== QApilot Poll Debug Log — ${new Date().toISOString()} ===\n`);

export function log(message: string): void {
  const timestamp = new Date().toISOString().substring(11, 19);
  const line = `[QApilot][${timestamp}] ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}
